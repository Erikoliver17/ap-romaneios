export type EventOrigin = 'bling' | 'wms'
export type EventStatus = 'pending' | 'processing' | 'success' | 'failed' | 'dlq'
export type MovementType = 'reservation' | 'physical' | 'adjustment'
export type MappingStatus = 'pending' | 'approved' | 'quarantine'
export type DlqResolution = 'reprocessed' | 'discarded'

export interface SyncEvent {
  id: string
  idempotencyKey: string
  origin: EventOrigin
  eventType: string
  entityId: string
  payload: Record<string, unknown>
  status: EventStatus
  retryCount: number
  receivedAt: Date
  processedAt?: Date
  errorMessage?: string
  queueName: string
}

export interface StockMovement {
  id: string
  eventId: string
  sku: string
  companyId: string
  delta: number
  movementType: MovementType
  reservationId?: string
  createdAt: Date
  metadata?: Record<string, unknown>
}

export interface StockSnapshot {
  id: string
  sku: string
  companyId: string
  balanceBling: number
  balanceWms: number
  lastReconciledAt?: Date
  updatedAt: Date
}

export interface ProductMapping {
  id: string
  skuBling: string
  skuWms?: string
  companyId: string
  status: MappingStatus
  confidence?: number
  quarantineReason?: string
  approvedBy?: string
  approvedAt?: Date
  createdAt: Date
  updatedAt: Date
}

export interface DeadLetterItem {
  id: string
  eventId: string
  origin: EventOrigin
  eventType: string
  entityId: string
  payload: Record<string, unknown>
  errorMessage?: string
  retryCount: number
  queuedAt: Date
  resolvedAt?: Date
  resolution?: DlqResolution
  resolutionReason?: string
  resolvedBy?: string
}

export interface AuditEntry {
  id: string
  action: string
  entityType: string
  entityId: string
  actor: string
  payload?: Record<string, unknown>
  createdAt: Date
}

export interface InternalJobPayload {
  eventId: string
  idempotencyKey: string
  origin: EventOrigin
  eventType: string
  entityId: string
  sku: string
  companyId: string
  delta: number
  reservationId?: string
  metadata?: Record<string, unknown>
}

export interface BlingWebhookBody {
  event: string
  retries: number
  data: {
    pedido?: {
      numero: string
      numeroPedidoCompra?: string
      itens: Array<{
        codigo: string
        quantidade: number
        descricao?: string
      }>
      deposito?: { id: number }
      empresa?: { id: number }
    }
    produto?: {
      id: number
      codigo: string
      estoque?: number
    }
  }
}

export interface WmsEventPayload {
  type: 'dispatch_confirmed' | 'stock_adjusted' | 'receiving'
  orderId: string
  sku: string
  companyId: string
  quantity: number
  reservationId?: string
  metadata?: Record<string, unknown>
}

// ── Smartgo WMS webhook body (inbound from Smartgo) ───────────────────────────
// tipoEvento values for expedição: GERADO | PEDIDO_EM_ATENDIMENTO | FINALIZADO | CANCELADO | ESTORNADO
// tipoEvento values for recebimento: GERADO | PEDIDO_EM_ATENDIMENTO | FINALIZADO | CANCELADO
export type SmartgoTipoEvento =
  | 'GERADO'
  | 'PEDIDO_EM_ATENDIMENTO'
  | 'FINALIZADO'
  | 'CANCELADO'
  | 'ESTORNADO'

export interface SmartgoWebhookBody {
  id:              string           // GUID — unique per delivery (not stable across retries)
  docEmpresa:      string           // CNPJ da empresa
  docDepositante:  string           // CNPJ do depositante
  tipoEvento:      SmartgoTipoEvento
  dataEvento:      string           // ISO 8601
  ambiente:        string           // 'PRODUCAO' | 'SANDBOX'
  classificacao:   string           // 'EXPEDICAO' | 'RECEBIMENTO' | 'MOVIMENTACAO'
  login:           string
  metadata: {
    codigoInterno:    string        // WMS internal order code — stable, used in idempotency key
    codigoExterno?:   string        // what we set at creation (= Bling order ID)
    quantidadeItens?: number
    produtos?: Array<{
      codigoProduto:   string
      quantidade:      number
      protocoloDeposito?: string
      rastreabilidade?: string
      lote?: string
    }>
    // Recebimento-specific fields
    dataRecebimento?: string
    dataFechamento?:  string
    dataCriacao?:     string
  }
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'down'
  checks: {
    postgres: 'ok' | 'error'
    redis: 'ok' | 'error'
    bling_api: 'ok' | 'error' | 'unknown'
    wms: 'ok' | 'error' | 'unknown'
  }
  queueLag: {
    bling_out_avg_ms: number | null
    wms_out_avg_ms: number | null
  }
  version: string
  uptime: number
}
