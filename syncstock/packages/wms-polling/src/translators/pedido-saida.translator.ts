import { wmsQuery } from '../db/wms-db.client'
import { WmsEventPayload } from '@syncstock/core'

export interface PedidoSaidaRow {
  ID_PEDIDO: string
  COD_PRODUTO: string
  QUANTIDADE: number
  DT_EXPEDICAO: Date
  STATUS: string
  ID_RESERVA?: string
}

// Read WMS dispatch orders table — only rows not yet imported
export async function fetchNewDispatches(
  lastImportedId: string,
  companyId: string
): Promise<{ events: WmsEventPayload[]; lastId: string }> {
  const { rows } = await wmsQuery<PedidoSaidaRow>(
    `SELECT ID_PEDIDO, COD_PRODUTO, QUANTIDADE, DT_EXPEDICAO, STATUS, ID_RESERVA
     FROM PEDIDO_SAIDA
     WHERE STATUS = 'EXPEDIDO'
       AND ID_PEDIDO > $1
     ORDER BY ID_PEDIDO ASC
     LIMIT 200`,
    [lastImportedId]
  )

  if (rows.length === 0) return { events: [], lastId: lastImportedId }

  const events: WmsEventPayload[] = rows.map((row) => ({
    type: 'dispatch_confirmed',
    orderId: row.ID_PEDIDO,
    sku: row.COD_PRODUTO,
    companyId,
    quantity: row.QUANTIDADE,
    reservationId: row.ID_RESERVA ?? undefined,
    metadata: {
      expeditionDate: row.DT_EXPEDICAO,
      source: 'wms_polling',
    },
  }))

  const lastId = rows[rows.length - 1].ID_PEDIDO
  return { events, lastId }
}
