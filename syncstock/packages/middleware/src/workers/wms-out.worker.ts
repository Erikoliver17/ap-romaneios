import { Worker, Job } from 'bullmq'
import { redis, query } from '@syncstock/core'
import type { InternalJobPayload } from '@syncstock/core'
import { createExpedicao, cancelExpedicao } from '../adapters/wms.adapter'
import { moveToDlq } from '../services/dlq.service'

const MAX_ATTEMPTS = parseInt(process.env.DLQ_MAX_ATTEMPTS ?? '3', 10)

/**
 * wms_out worker — calls Smartgo REST API
 *
 * Rate limit: Smartgo enforces 120 req/min per api_key.
 * BullMQ limiter: max=120, duration=60_000ms → matches Smartgo's bucket.
 * concurrency=1 ensures we don't burst across multiple concurrent jobs.
 */
export function createWmsOutWorker(): Worker {
  const worker = new Worker('wms_out', processJob, {
    connection:  redis,
    concurrency: 1,
    limiter:     { max: 100, duration: 60_000 },  // 100/min, 20 below cap for headroom
  })

  worker.on('failed', async (job, err) => {
    if (!job) return
    if (job.attemptsMade >= MAX_ATTEMPTS) {
      await moveToDlq(job.data as InternalJobPayload, err.message, job.attemptsMade)
        .catch(console.error)
    }
  })

  worker.on('error', (err) => console.error('[wms_out] worker error', err))
  return worker
}

async function processJob(job: Job): Promise<void> {
  const payload = job.data as InternalJobPayload & {
    wmsCodigoInterno?: string  // set on cancellation jobs (from prior reservation)
  }

  await query(`UPDATE events SET status = 'processing' WHERE id = $1`, [payload.eventId])

  if (payload.eventType === 'pedido.cancelado' || payload.eventType === 'cancelamento') {
    await processCancellation(payload)
  } else {
    await processReservation(payload)
  }

  await query(
    `UPDATE events SET status = 'success', processed_at = NOW() WHERE id = $1`,
    [payload.eventId]
  )
}

async function processReservation(payload: InternalJobPayload): Promise<void> {
  // Resolve WMS product code from approved mapping
  const { rows } = await query<{ sku_wms: string }>(
    `SELECT sku_wms FROM product_mappings
     WHERE sku_bling = $1 AND company_id = $2 AND status = 'approved'`,
    [payload.sku, payload.companyId]
  )

  if (rows.length === 0) {
    // Mapping removed or moved to quarantine after job was queued — drop silently
    console.warn(`[wms_out] no approved mapping for sku=${payload.sku}, skipping`)
    return
  }

  const result = await createExpedicao({
    blingOrderId: payload.entityId,
    items: [
      {
        numeroDoItem:  1,
        codigoProduto: rows[0].sku_wms,
        quantidade:    Math.abs(payload.delta),
      },
    ],
  })

  // Persist WMS reference so the wms_in FINALIZADO can find the reservation
  await query(
    `UPDATE stock_movements
     SET metadata = COALESCE(metadata, '{}'::jsonb) || $1::jsonb
     WHERE event_id = $2 AND movement_type = 'reservation'`,
    [
      JSON.stringify({ wms_codigo_interno: result.codigoInterno }),
      payload.eventId,
    ]
  )

  console.info(
    `[wms_out] expedition created: blingOrder=${payload.entityId} ` +
    `wmsCode=${result.codigoInterno} qty=${Math.abs(payload.delta)}`
  )
}

async function processCancellation(
  payload: InternalJobPayload & { wmsCodigoInterno?: string }
): Promise<void> {
  if (!payload.wmsCodigoInterno) {
    console.warn(
      `[wms_out] cancellation for order ${payload.entityId} has no wmsCodigoInterno — ` +
      'expedition may not have been created yet, skipping WMS cancel'
    )
    return
  }

  await cancelExpedicao(
    payload.wmsCodigoInterno,
    payload.entityId,
    'Cancelado pelo Bling'
  )

  console.info(
    `[wms_out] expedition cancelled: wmsCode=${payload.wmsCodigoInterno} order=${payload.entityId}`
  )
}
