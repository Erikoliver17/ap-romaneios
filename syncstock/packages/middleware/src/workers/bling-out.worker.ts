import { Worker, Job } from 'bullmq'
import { redis, query, InternalJobPayload } from '@syncstock/core'
import { updateBlingStock } from '../adapters/bling.adapter'
import { moveToDlq } from '../services/dlq.service'

const MAX_ATTEMPTS = parseInt(process.env.MAX_RETRIES ?? '3', 10)
const DEFAULT_DEPOSITO_ID = parseInt(process.env.BLING_DEFAULT_DEPOSITO_ID ?? '1', 10)

export function createBlingOutWorker(): Worker {
  const worker = new Worker('bling_out', processJob, {
    connection: redis,
    concurrency: 3,
    limiter: { max: 20, duration: 1_000 },
  })

  worker.on('failed', async (job, err) => {
    if (!job) return
    if (job.attemptsMade >= MAX_ATTEMPTS) {
      const payload = job.data as InternalJobPayload
      await moveToDlq(payload, err.message, job.attemptsMade).catch(console.error)
    }
  })

  worker.on('error', (err) => console.error('[bling_out] worker error', err))

  return worker
}

async function processJob(job: Job): Promise<void> {
  const payload = job.data as InternalJobPayload & {
    absoluteQuantity: number
    depositoId?: number
  }

  await query(`UPDATE events SET status = 'processing' WHERE id = $1`, [payload.eventId])

  await updateBlingStock(
    payload.sku,
    payload.depositoId ?? DEFAULT_DEPOSITO_ID,
    payload.absoluteQuantity
  )

  await query(
    `UPDATE events SET status = 'success', processed_at = NOW() WHERE id = $1`,
    [payload.eventId]
  )
}
