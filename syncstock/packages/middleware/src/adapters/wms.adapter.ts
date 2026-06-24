/**
 * Smartgo WMS REST adapter
 * Docs: https://apigateway.smartgo.com.br/
 * Rate limit: 120 calls / minute per api_key (enforced at BullMQ queue level)
 */

const BASE_URL = () => process.env.WMS_BASE_URL ?? 'https://apigateway.smartgo.com.br'
const API_KEY  = () => process.env.WMS_API_KEY ?? ''
const DOC_DEP  = () => process.env.WMS_DOC_DEPOSITANTE ?? ''

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SmartgoExpedicaoItem {
  numeroDoItem: number
  codigoProduto: string  // WMS product code (sku_wms from product_mappings)
  quantidade: number
}

export interface CreateExpedicaoParams {
  blingOrderId: string          // stored as cabecalho.codigoExterno — join key on webhook return
  items: SmartgoExpedicaoItem[]
  observacao?: string
}

export interface CreateExpedicaoResult {
  codigoInterno: string         // WMS order code — store in stock_movements.metadata
  codigoExterno: string         // mirrors blingOrderId we sent
}

export interface EstoqueSaldoItem {
  produtoCodigoExterno: string
  produtoCodigoInterno: string
  quantidadeDisponivel: number
  quantidadeEmExpedicao: number
  areaComputaSaldo: boolean
}

// ─── Expedition ───────────────────────────────────────────────────────────────

/**
 * Creates a WMS expedition order for a Bling sale.
 * codigoExterno = blingOrderId so the FINALIZADO webhook links back to us.
 */
export async function createExpedicao(
  params: CreateExpedicaoParams
): Promise<CreateExpedicaoResult> {
  const body = {
    cabecalho: {
      codigoExterno: params.blingOrderId,
      observacao:    params.observacao ?? 'SyncStock',
      origemPedido:  'INTEGRACAO_API',
    },
    pedidoItens: params.items.map((item) => ({
      numeroDoItem:   item.numeroDoItem,
      codigoProduto:  item.codigoProduto,
      quantidade:     item.quantidade,
    })),
  }

  const res = await smartgoFetch('/expedicao/produto', {
    method: 'POST',
    body: JSON.stringify(body),
  })

  const json = await res.json() as {
    success: boolean
    model: { codigoInterno: string; codigoExterno: string }
    errors?: Array<{ key: string; value: string }>
  }

  if (!json.success) {
    const detail = json.errors?.map((e) => `${e.key}: ${e.value}`).join('; ') ?? 'unknown'
    throw new Error(`Smartgo createExpedicao failed: ${detail}`)
  }

  return json.model
}

/**
 * Cancels a WMS expedition order.
 * Requires codigoInterno (string from creation response).
 * Smartgo schema marks idPedido as required; we pass codigoInterno + codigoExterno
 * and let Smartgo resolve. On 400, the job moves to DLQ for manual handling.
 */
export async function cancelExpedicao(
  codigoInterno: string,
  blingOrderId: string,
  motivo: string = 'Cancelado por integração SyncStock'
): Promise<void> {
  const body = {
    codigoInterno,
    codigoExterno:        blingOrderId,
    MotivoCancelamento:   motivo,
  }

  const res = await smartgoFetch('/expedicao/pedido/cancelar', {
    method: 'PATCH',
    body: JSON.stringify(body),
  })

  const json = await res.json() as { success: boolean; errors?: Array<{ key: string; value: string }> }
  if (!json.success) {
    const detail = json.errors?.map((e) => `${e.key}: ${e.value}`).join('; ') ?? 'unknown'
    throw new Error(`Smartgo cancelExpedicao failed for ${codigoInterno}: ${detail}`)
  }
}

// ─── Stock balance ────────────────────────────────────────────────────────────

/**
 * Returns the sum of quantidadeDisponivel across all storage areas that count
 * toward balance (areaComputaSaldo = true) for the given WMS product code.
 *
 * Used by the reconciliation cron — NOT by webhook workers.
 */
export async function getEstoqueDisponivel(wmsCodigoProduto: string): Promise<number> {
  const params = new URLSearchParams({
    CodigoProduto: wmsCodigoProduto,
    PageSize:      '1000',
    PageNumber:    '1',
  })

  const res = await smartgoFetch(`/estoque/saldo?${params}`, { method: 'GET' })
  const json = await res.json() as {
    success: boolean
    model: EstoqueSaldoItem[]
    errors?: Array<{ key: string; value: string }>
  }

  if (!json.success) {
    const detail = json.errors?.map((e) => `${e.key}: ${e.value}`).join('; ') ?? 'unknown'
    throw new Error(`Smartgo getEstoqueSaldo failed for ${wmsCodigoProduto}: ${detail}`)
  }

  return (json.model ?? [])
    .filter((row) => row.areaComputaSaldo)
    .reduce((sum, row) => sum + (row.quantidadeDisponivel ?? 0), 0)
}

// ─── Health check ─────────────────────────────────────────────────────────────

export async function checkWmsHealth(): Promise<boolean> {
  try {
    // Lightest call that confirms auth + connectivity: saldo with no results
    const params = new URLSearchParams({ CodigoProduto: '__health_check__', PageSize: '1', PageNumber: '1' })
    const res = await smartgoFetch(`/estoque/saldo?${params}`, {
      method: 'GET',
      signal: AbortSignal.timeout(5_000),
    })
    // 401/403 → misconfigured, 404/200 → reachable
    return res.status !== 500
  } catch {
    return false
  }
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function smartgoFetch(path: string, init: RequestInit): Promise<Response> {
  const url = `${BASE_URL()}${path}`

  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type':   'application/json',
      'api_key':        API_KEY(),
      'doc_depositante': DOC_DEP(),
      ...(init.headers as Record<string, string> | undefined),
    },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  })

  if (res.status === 429) {
    throw new Error('Smartgo rate limit exceeded (120 req/min) — BullMQ will retry')
  }

  if (!res.ok && res.status >= 500) {
    throw new Error(`Smartgo server error ${res.status} on ${path}`)
  }

  return res
}
