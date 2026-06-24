import { createHash } from 'crypto'
import { query } from '@syncstock/core'

/**
 * Key = SHA256(origin:eventType:entityId:version)
 * Timestamp is NEVER part of the key — same event retried later must produce
 * the same key. Timestamp goes only in events.received_at.
 */
export function buildIdempotencyKey(
  origin: string,
  eventType: string,
  entityId: string,
  version: string
): string {
  return createHash('sha256')
    .update(`${origin}:${eventType}:${entityId}:${version}`)
    .digest('hex')
}

/**
 * Returns true  → key is new, caller should process the event.
 * Returns false → key already exists, caller should skip (duplicate).
 */
export async function acquireIdempotencyKey(
  key: string,
  eventId: string
): Promise<boolean> {
  try {
    await query(
      'INSERT INTO idempotency_keys (key, event_id) VALUES ($1, $2)',
      [key, eventId]
    )
    return true
  } catch (err: any) {
    if (err.code === '23505') return false  // unique_violation → duplicate
    throw err
  }
}
