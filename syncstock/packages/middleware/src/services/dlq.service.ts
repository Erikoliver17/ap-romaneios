import { query, withTransaction, DeadLetterItem, InternalJobPayload, queues } from '@syncstock/core'
import { writeAuditLog } from './audit.service'

const MAX_RETRIES = parseInt(process.env.MAX_RETRIES ?? '3', 10)

export async function moveToDlq(
  job: InternalJobPayload,
  errorMessage: string,
  retryCount: number
): Promise<string> {
  const result = await query<{ id: string }>(
    `INSERT INTO dead_letter_queue
       (event_id, origin, event_type, entity_id, payload, error_message, retry_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [
      job.eventId,
      job.origin,
      job.eventType,
      job.entityId,
      JSON.stringify(job),
      errorMessage,
      retryCount,
    ]
  )

  await query(
    `UPDATE events SET status = 'dlq', error_message = $2 WHERE id = $1`,
    [job.eventId, errorMessage]
  )

  return result.rows[0].id
}

export async function reprocessDlqItem(
  dlqId: string,
  actor: string
): Promise<void> {
  const { rows } = await query<DeadLetterItem>(
    `SELECT * FROM dead_letter_queue WHERE id = $1 AND resolved_at IS NULL`,
    [dlqId]
  )
  if (rows.length === 0) throw new Error(`DLQ item ${dlqId} not found or already resolved`)

  const item = rows[0]

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE dead_letter_queue
       SET resolved_at = NOW(), resolution = 'reprocessed', resolved_by = $2
       WHERE id = $1`,
      [dlqId, actor]
    )

    await client.query(
      `UPDATE events SET status = 'pending', retry_count = 0, error_message = NULL
       WHERE id = $1`,
      [item.event_id as unknown as string]
    )
  })

  const payload = item.payload as unknown as InternalJobPayload
  const targetQueue = queues[payload.origin === 'bling' ? 'bling_in' : 'wms_in']
  await targetQueue.add('reprocessed', payload, { attempts: MAX_RETRIES })

  await writeAuditLog({
    action: 'dlq_reprocess',
    entityType: 'dead_letter_queue',
    entityId: dlqId,
    actor,
    payload: { origin: item.origin, eventType: item.event_type, entityId: item.entity_id } as Record<string, unknown>,
  })
}

export async function discardDlqItem(
  dlqId: string,
  reason: string,
  actor: string
): Promise<void> {
  if (!reason?.trim()) throw new Error('Discard reason is required')

  const { rows } = await query(
    `SELECT id FROM dead_letter_queue WHERE id = $1 AND resolved_at IS NULL`,
    [dlqId]
  )
  if (rows.length === 0) throw new Error(`DLQ item ${dlqId} not found or already resolved`)

  await query(
    `UPDATE dead_letter_queue
     SET resolved_at = NOW(), resolution = 'discarded',
         resolution_reason = $2, resolved_by = $3
     WHERE id = $1`,
    [dlqId, reason, actor]
  )

  await writeAuditLog({
    action: 'dlq_discard',
    entityType: 'dead_letter_queue',
    entityId: dlqId,
    actor,
    payload: { reason } as Record<string, unknown>,
  })
}

export async function listOpenDlqItems(): Promise<DeadLetterItem[]> {
  const { rows } = await query<DeadLetterItem>(
    `SELECT * FROM dead_letter_queue
     WHERE resolved_at IS NULL
     ORDER BY queued_at DESC
     LIMIT 100`
  )
  return rows
}
