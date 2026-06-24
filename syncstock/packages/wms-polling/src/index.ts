import { queues, redis, query, WmsEventPayload } from '@syncstock/core'
import { buildIdempotencyKey } from '../../middleware/src/services/idempotency.service'
import { checkWmsDbConnection } from './db/wms-db.client'
import { fetchNewDispatches } from './translators/pedido-saida.translator'
import { fetchBalanceChanges } from './translators/saldo-estoque.translator'

const POLL_INTERVAL_MS = parseInt(process.env.WMS_POLL_INTERVAL_MS ?? '30000', 10)
const COMPANY_ID = process.env.WMS_COMPANY_ID ?? '1'

// Cursor persisted in DB to survive restarts
async function getCursor(key: string): Promise<string> {
  const { rows } = await query<{ value: string }>(
    `SELECT value FROM polling_cursors WHERE key = $1`,
    [key]
  ).catch(() => ({ rows: [] }))
  return rows[0]?.value ?? '0'
}

async function setCursor(key: string, value: string): Promise<void> {
  await query(
    `INSERT INTO polling_cursors (key, value, updated_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
    [key, value]
  )
}

async function enqueueWmsEvent(ev: WmsEventPayload): Promise<void> {
  const version = ev.metadata?.updatedAt
    ? String((ev.metadata.updatedAt as Date).getTime())
    : '0'
  const idempotencyKey = buildIdempotencyKey('wms', ev.type, ev.orderId, version)

  const { rows } = await query<{ id: string }>(
    `INSERT INTO events
       (idempotency_key, origin, event_type, entity_id, payload, queue_name)
     VALUES ($1, 'wms', $2, $3, $4, 'wms_in')
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [idempotencyKey, ev.type, ev.orderId, JSON.stringify(ev)]
  )

  if (rows.length > 0) {
    await queues.wms_in.add(ev.type, {
      eventId: rows[0].id,
      idempotencyKey,
      origin: 'wms',
      eventType: ev.type,
      entityId: ev.orderId,
      payload: ev,
    })
  }
}

async function poll(): Promise<void> {
  const isUp = await checkWmsDbConnection()
  if (!isUp) {
    console.warn('[wms-polling] WMS DB unreachable, skipping poll')
    return
  }

  // 1. Dispatch confirmations
  const lastDispatchId = await getCursor(`dispatch_${COMPANY_ID}`)
  const { events: dispatches, lastId } = await fetchNewDispatches(lastDispatchId, COMPANY_ID)
  for (const ev of dispatches) await enqueueWmsEvent(ev)
  if (dispatches.length > 0) await setCursor(`dispatch_${COMPANY_ID}`, lastId)

  // 2. Balance changes (incremental, last 2 × poll interval as safety window)
  const since = new Date(Date.now() - POLL_INTERVAL_MS * 2)
  const balanceEvents = await fetchBalanceChanges(since, COMPANY_ID)
  for (const ev of balanceEvents) await enqueueWmsEvent(ev)

  if (dispatches.length > 0 || balanceEvents.length > 0) {
    console.log(`[wms-polling] queued ${dispatches.length} dispatches, ${balanceEvents.length} balance changes`)
  }
}

async function main(): Promise<void> {
  console.log(`[wms-polling] starting, interval=${POLL_INTERVAL_MS}ms, company=${COMPANY_ID}`)

  const run = async (): Promise<void> => {
    try {
      await poll()
    } catch (err) {
      console.error('[wms-polling] poll error', err)
    } finally {
      setTimeout(() => void run(), POLL_INTERVAL_MS)
    }
  }

  await run()

  const shutdown = async (): Promise<void> => {
    await redis.quit()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

main().catch((err) => {
  console.error('[wms-polling] fatal', err)
  process.exit(1)
})
