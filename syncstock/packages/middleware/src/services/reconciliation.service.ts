import { query } from '@syncstock/core'
import { getEstoqueDisponivel } from '../adapters/wms.adapter'

interface BlingStockResponse {
  data: Array<{
    codigo: string
    depositos: Array<{ saldoFisico: number; id: number }>
  }>
}

export async function runReconciliation(companyId: string): Promise<void> {
  console.log(`[reconciliation] starting for company=${companyId}`)

  const { rows: mappings } = await query<{ sku_bling: string; sku_wms: string }>(
    `SELECT sku_bling, sku_wms FROM product_mappings
     WHERE status = 'approved' AND company_id = $1 AND sku_wms IS NOT NULL`,
    [companyId]
  )

  let reconciled = 0
  let errors     = 0

  for (const mapping of mappings) {
    try {
      await reconcileSku(mapping.sku_bling, mapping.sku_wms, companyId)
      reconciled++
    } catch (err) {
      errors++
      console.error(`[reconciliation] error on SKU ${mapping.sku_bling}`, err)
    }
  }

  console.log(`[reconciliation] done for company=${companyId}: ${reconciled} ok, ${errors} errors`)
}

async function reconcileSku(
  skuBling: string,
  skuWms:   string,
  companyId: string
): Promise<void> {
  const [blingBalance, wmsBalance] = await Promise.all([
    fetchBlingBalance(skuBling),
    fetchWmsBalance(skuWms),
  ])

  await query(
    `INSERT INTO stock_snapshots (sku, company_id, balance_bling, balance_wms, last_reconciled_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (sku, company_id) DO UPDATE
       SET balance_bling      = EXCLUDED.balance_bling,
           balance_wms        = EXCLUDED.balance_wms,
           last_reconciled_at = EXCLUDED.last_reconciled_at,
           updated_at         = NOW()`,
    [skuBling, companyId, blingBalance, wmsBalance]
  )

  const diff = wmsBalance - blingBalance
  if (Math.abs(diff) > 0) {
    console.warn(
      `[reconciliation] divergence: sku=${skuBling} bling=${blingBalance} wms=${wmsBalance} diff=${diff}`
    )
  }
}

async function fetchBlingBalance(sku: string): Promise<number> {
  const apiKey  = process.env.BLING_API_KEY
  const baseUrl = process.env.BLING_API_URL ?? 'https://www.bling.com.br/Api/v3'

  const res = await fetch(`${baseUrl}/estoques?codigo=${encodeURIComponent(sku)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal:  AbortSignal.timeout(10_000),
  })

  if (!res.ok) throw new Error(`Bling API ${res.status} fetching balance for ${sku}`)
  const json = (await res.json()) as BlingStockResponse

  const product = json.data?.[0]
  if (!product) return 0
  return product.depositos?.reduce((sum, d) => sum + d.saldoFisico, 0) ?? 0
}

/**
 * Fetches the available stock for a WMS product using Smartgo's /estoque/saldo.
 *
 * Uses quantidadeDisponivel (not quantidadeDisponivel + quantidadeEmExpedicao)
 * so that items in in-flight expeditions don't appear as a false divergence.
 * A missing expedition (wms-out bug) shows as divergence because WMS would
 * still show the item as available while Bling has already deducted it.
 */
async function fetchWmsBalance(skuWms: string): Promise<number> {
  return getEstoqueDisponivel(skuWms)
}
