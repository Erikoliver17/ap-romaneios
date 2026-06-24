import { Worker, Job } from 'bullmq'
import { redis, query, queues } from '@syncstock/core'
import type { InternalJobPayload, SmartgoWebhookBody } from '@syncstock/core'
import { acquireIdempotencyKey } from '../services/idempotency.service'
import { confirmDispatch, writeStockMovement } from '../services/stock.service'
import { moveToDlq } from '../services/dlq.service'

const MAX_ATTEMPTS = parseInt(process.env.DLQ_MAX_ATTEMPTS ?? '3', 10)

export function createWmsInWorker(): Worker {
  const worker = new Worker('wms_in', processJob, {
    connection:  redis,
    concurrency: 5,
  })

  worker.on('failed', async (job, err) => {
    if (!job) return
    if (job.attemptsMade >= MAX_ATTEMPTS) {
      await moveToDlq(job.data as InternalJobPayload, err.message, job.attemptsMade)
        .catch(console.error)
    }
  })

  worker.on('error', (err) => console.error('[wms_in] worker error', err))
  return worker
}

async function processJob(job: Job): Promise<void> {
  const data = job.data as {
    eventId:        string
    idempotencyKey: string
    companyId:      string
    payload:        SmartgoWebhookBody
  }

  await query(`UPDATE events SET status = 'processing' WHERE id = $1`, [data.eventId])

  const acquired = await acquireIdempotencyKey(data.idempotencyKey, data.eventId)
  if (!acquired) {
    // Duplicate — idempotency check already passed in webhook handler, but belt-and-suspenders
    await query(`UPDATE events SET status = 'success' WHERE id = $1`, [data.eventId])
    return
  }

  const wmsEvent  = data.payload
  const tipoEvento = wmsEvent.tipoEvento?.toUpperCase()

  switch (tipoEvento) {
    case 'FINALIZADO':
      await handleFinalizado(data.eventId, wmsEvent, data.companyId)
      break

    case 'CANCELADO':
    case 'ESTORNADO':
      await handleCancelado(data.eventId, wmsEvent, data.companyId)
      break

    default:
      // GERADO, PEDIDO_EM_ATENDIMENTO — informational, no stock action needed
      console.info(`[wms_in] informational event ${tipoEvento}, no action`)
  }

  await query(
    `UPDATE events SET status = 'success', processed_at = NOW() WHERE id = $1`,
    [data.eventId]
  )
}

/**
 * Expedition FINALIZADO — items physically dispatched.
 * Finds the matching reservation by wms_codigo_interno stored in metadata,
 * upgrades it to a physical movement, and links the two rows.
 */
async function handleFinalizado(
  eventId: string,
  ev: SmartgoWebhookBody,
  companyId: string
): Promise<void> {
  const codigoInterno = ev.metadata.codigoInterno
  // codigoExterno is the Bling order ID we set at expedition creation
  const blingOrderId  = ev.metadata.codigoExterno

  if (!blingOrderId) {
    console.warn(`[wms_in] FINALIZADO ${codigoInterno} missing codigoExterno — cannot match reservation`)
    return
  }

  // Find the open reservation for this WMS order
  const { rows: reservations } = await query<{ id: string; sku: string; delta: number }>(
    `SELECT sm.id, sm.sku, sm.delta
     FROM stock_movements sm
     JOIN events e ON e.id = sm.event_id
     WHERE e.entity_id = $1
       AND sm.company_id = $2
       AND sm.movement_type = 'reservation'
       AND sm.metadata->>'wms_codigo_interno' = $3
     LIMIT 1`,
    [blingOrderId, companyId, codigoInterno]
  )

  if (reservations.length === 0) {
    console.warn(
      `[wms_in] no reservation found for blingOrder=${blingOrderId} wmsCode=${codigoInterno}. ` +
      'Writing adjustment movement instead.'
    )
    // Sum product quantities from webhook to write an adjustment
    const totalQty = (ev.metadata.produtos ?? []).reduce((s, p) => s + (p.quantidade ?? 0), 0)
    if (totalQty > 0) {
      await writeStockMovement({
        eventId,
        sku:          ev.metadata.produtos?.[0]?.codigoProduto ?? 'unknown',
        companyId,
        delta:        -totalQty,
        movementType: 'adjustment',
        metadata:     { source: 'wms_finalizado_orphan', wms_codigo_interno: codigoInterno },
      })
    }
    return
  }

  const reservation = reservations[0]

  await confirmDispatch({
    eventId,
    sku:           reservation.sku,
    companyId,
    quantity:      Math.abs(reservation.delta),
    reservationId: reservation.id,
  })

  console.info(
    `[wms_in] FINALIZADO: confirmed dispatch blingOrder=${blingOrderId} ` +
    `wmsCode=${codigoInterno} qty=${Math.abs(reservation.delta)}`
  )
}

/**
 * Expedition CANCELADO/ESTORNADO — WMS cancelled the order (e.g., out of stock).
 * Reverses the reservation delta so stock is restored in our ledger.
 */
async function handleCancelado(
  eventId: string,
  ev: SmartgoWebhookBody,
  companyId: string
): Promise<void> {
  const codigoInterno = ev.metadata.codigoInterno
  const blingOrderId  = ev.metadata.codigoExterno

  if (!blingOrderId) {
    console.warn(`[wms_in] CANCELADO ${codigoInterno} missing codigoExterno`)
    return
  }

  const { rows: reservations } = await query<{ id: string; sku: string; delta: number }>(
    `SELECT id, sku, delta FROM stock_movements
     WHERE company_id = $1
       AND movement_type = 'reservation'
       AND metadata->>'wms_codigo_interno' = $2
     LIMIT 1`,
    [companyId, codigoInterno]
  )

  if (reservations.length === 0) {
    console.warn(`[wms_in] no reservation to reverse for wmsCode=${codigoInterno}`)
    return
  }

  const reservation = reservations[0]

  // Write reversal as 'cancellation' movement (positive delta restores stock)
  await writeStockMovement({
    eventId,
    sku:          reservation.sku,
    companyId,
    delta:        Math.abs(reservation.delta),  // positive = restore
    movementType: 'cancellation',
    metadata:     {
      source:             'wms_cancelado',
      wms_codigo_interno: codigoInterno,
      reverses_id:        reservation.id,
    },
  })

  // Mark original reservation as cancelled
  await query(
    `UPDATE stock_movements SET movement_type = 'cancellation' WHERE id = $1`,
    [reservation.id]
  )

  console.info(
    `[wms_in] CANCELADO: reversed reservation id=${reservation.id} wmsCode=${codigoInterno}`
  )
}
