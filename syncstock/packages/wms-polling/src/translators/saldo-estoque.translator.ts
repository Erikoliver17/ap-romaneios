import { wmsQuery } from '../db/wms-db.client'
import { WmsEventPayload } from '@syncstock/core'

export interface SaldoEstoqueRow {
  COD_PRODUTO: string
  SALDO_FISICO: number
  DT_ATUALIZACAO: Date
}

export interface SaldoSnapshot {
  sku: string
  balance: number
  updatedAt: Date
}

// Full snapshot of WMS physical balances — used by reconciliation
export async function fetchWmsBalances(): Promise<SaldoSnapshot[]> {
  const { rows } = await wmsQuery<SaldoEstoqueRow>(
    `SELECT COD_PRODUTO, SALDO_FISICO, DT_ATUALIZACAO
     FROM SALDO_ESTOQUE
     WHERE ATIVO = 1`
  )

  return rows.map((row) => ({
    sku: row.COD_PRODUTO,
    balance: row.SALDO_FISICO,
    updatedAt: row.DT_ATUALIZACAO,
  }))
}

// Delta: rows updated since last check (for incremental stock adjustment events)
export async function fetchBalanceChanges(
  since: Date,
  companyId: string
): Promise<WmsEventPayload[]> {
  const { rows } = await wmsQuery<SaldoEstoqueRow>(
    `SELECT COD_PRODUTO, SALDO_FISICO, DT_ATUALIZACAO
     FROM SALDO_ESTOQUE
     WHERE DT_ATUALIZACAO > $1
       AND ATIVO = 1`,
    [since]
  )

  return rows.map((row) => ({
    type: 'stock_adjusted',
    orderId: `wms_balance_${row.COD_PRODUTO}_${row.DT_ATUALIZACAO.toISOString()}`,
    sku: row.COD_PRODUTO,
    companyId,
    quantity: row.SALDO_FISICO,
    metadata: { updatedAt: row.DT_ATUALIZACAO, source: 'wms_polling' },
  }))
}
