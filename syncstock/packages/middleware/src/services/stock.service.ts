import { PoolClient } from 'pg'
import { MovementType, withTransaction } from '@syncstock/core'

export interface WriteMovementParams {
  eventId: string
  sku: string
  companyId: string
  delta: number
  movementType: MovementType
  reservationId?: string
  metadata?: Record<string, unknown>
}

/**
 * Write a delta movement — never overwrite the absolute balance.
 * Absolute balance in stock_snapshots is updated ONLY by the reconciliation cron.
 */
export async function writeStockMovement(
  params: WriteMovementParams,
  client?: PoolClient
): Promise<string> {
  const sql = `
    INSERT INTO stock_movements
      (event_id, sku, company_id, delta, movement_type, reservation_id, metadata)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id
  `
  const values = [
    params.eventId,
    params.sku,
    params.companyId,
    params.delta,
    params.movementType,
    params.reservationId ?? null,
    params.metadata ? JSON.stringify(params.metadata) : null,
  ]

  const result = client
    ? await client.query(sql, values)
    : await (await import('@syncstock/core')).query(sql, values)

  return result.rows[0].id as string
}

/**
 * Confirm a reservation as a physical dispatch.
 * Inserts a 'physical' row and links it to the original reservation.
 */
export async function confirmDispatch(params: {
  eventId: string
  sku: string
  companyId: string
  quantity: number
  reservationId: string
}): Promise<void> {
  await withTransaction(async (client) => {
    await writeStockMovement(
      {
        eventId: params.eventId,
        sku: params.sku,
        companyId: params.companyId,
        delta: -params.quantity,
        movementType: 'physical',
        reservationId: params.reservationId,
      },
      client
    )
  })
}

export async function getPendingBalance(
  sku: string,
  companyId: string
): Promise<{ reservations: number; physical: number }> {
  const { query } = await import('@syncstock/core')
  const result = await query<{ movement_type: string; total: string }>(
    `SELECT movement_type, SUM(delta) AS total
     FROM stock_movements
     WHERE sku = $1 AND company_id = $2
       AND movement_type IN ('reservation','physical')
       AND created_at > NOW() - INTERVAL '1 day'
     GROUP BY movement_type`,
    [sku, companyId]
  )

  let reservations = 0
  let physical = 0
  for (const row of result.rows) {
    if (row.movement_type === 'reservation') reservations = parseInt(row.total, 10)
    if (row.movement_type === 'physical') physical = parseInt(row.total, 10)
  }
  return { reservations, physical }
}
