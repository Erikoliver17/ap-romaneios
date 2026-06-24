import { Worker, Job, UnrecoverableError } from 'bullmq'
import { redis, query, InternalJobPayload, BlingWebhookBody } from '@syncstock/core'
import { acquireIdempotencyKey } from '../services/idempotency.service'
import { writeStockMovement } from '../services/stock.service'
import { findApprovedMapping } from '../services/mapping.service'
import { moveToDlq } from '../services/dlq.service'
import { sendReservationToWms } from '../adapters/wms.adapter'

const MAX_ATTEMPTS = parseInt(process.env.MAX_RETRIES ?? '3', 10)

export function createBlingInWorker(): Worker {
  const worker = new Worker('bling_in', processJob, {
    connection: redis,
    concurrency: 5,
    limiter: { max: 50, duration: 1_000 },
  })

  worker.on('failed', async (job, err) => {
    if (!job) return
    const attempts = job.attemptsMade
    if (attempts >= MAX_ATTEMPTS) {
      console.error(`[bling_in] job ${job.id} exhausted retries, moving to DLQ`, err.message)
      const payload = job.data as InternalJobPayload
      await moveToDlq(payload, err.message, attempts).catch(console.error)
    }
  })

  worker.on('error', (err) => console.error('[bling_in] worker error', err))

  return worker
}

async function processJob(job: Job): Promise<void> {
  const raw = job.data as { eventId: string; idempotencyKey: string; companyId: string; payload: BlingWebhookBody }

  await query(`UPDATE events SET status = 'processing' WHERE id = $1`, [raw.eventId])

  const acquired = await acquireIdempotencyKey(raw.idempotencyKey, raw.eventId)
  if (!acquired) {
    await query(`UPDATE events SET status = 'success' WHERE id = $1`, [raw.eventId])
    return
  }

  const body = raw.payload
  const items = body.data.pedido?.itens ?? []

  for (const item of items) {
    const sku = item.codigo
    const mapping = await findApprovedMapping(sku, raw.companyId)

    if (!mapping) {
      console.warn(`[bling_in] no approved mapping for sku=${sku} company=${raw.companyId}`)
      continue
    }

    const delta = computeDelta(body.event, item.quantidade)
    if (delta === null) continue

    const jobPayload: InternalJobPayload = {
      eventId: raw.eventId,
      idempotencyKey: raw.idempotencyKey,
      origin: 'bling',
      eventType: body.event,
      entityId: body.data.pedido?.numero ?? sku,
      sku,
      companyId: raw.companyId,
      delta,
      metadata: { skuWms: mapping.sku_wms, blingOrderNumber: body.data.pedido?.numero },
    }

    const movementId = await writeStockMovement({
      eventId: raw.eventId,
      sku,
      companyId: raw.companyId,
      delta,
      movementType: 'reservation',
      metadata: { source: 'bling', event: body.event },
    })

    if (process.env.WMS_MODE === 'modern') {
      try {
        await sendReservationToWms({
          orderId: body.data.pedido?.numero ?? sku,
          sku: mapping.sku_wms ?? sku,
          quantity: item.quantidade,
          companyId: raw.companyId,
        })
      } catch (err: any) {
        // Re-throw so BullMQ retries; reservation movement is not rolled back yet
        // (will be reconciled on next cron run if WMS fails permanently)
        throw new Error(`WMS reservation failed for sku=${sku}: ${err.message}`)
      }
    } else {
      // Legacy WMS: push to wms_out queue for polling-based handoff
      const { queues } = await import('@syncstock/core')
      await queues.wms_out.add('reservation', { ...jobPayload, reservationId: movementId })
    }
  }

  await query(
    `UPDATE events SET status = 'success', processed_at = NOW() WHERE id = $1`,
    [raw.eventId]
  )
}

function computeDelta(event: string, quantity: number): number | null {
  switch (event) {
    case 'pedido.incluido':
    case 'pedido.alterado':
      return -Math.abs(quantity)
    case 'pedido.cancelado':
      return +Math.abs(quantity)
    default:
      return null
  }
}
