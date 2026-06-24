import Fastify from 'fastify'
import cron from 'node-cron'
import { redis, queues } from '@syncstock/core'
import { registerBlingWebhooks } from './webhooks/bling'
import { registerWmsWebhooks } from './webhooks/wms'
import { registerHealthRoute } from './health'
import { createBlingInWorker } from './workers/bling-in.worker'
import { createBlingOutWorker } from './workers/bling-out.worker'
import { createWmsInWorker } from './workers/wms-in.worker'
import { createWmsOutWorker } from './workers/wms-out.worker'
import { runReconciliation } from './services/reconciliation.service'

const PORT = parseInt(process.env.PORT ?? '3000', 10)
const RECONCILIATION_COMPANY_ID = process.env.WMS_COMPANY_ID ?? '1'

async function main(): Promise<void> {
  const app = Fastify({ logger: true })

  // Store raw body for HMAC verification
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    ;(req as any).rawBody = body
    try {
      done(null, JSON.parse(body as string))
    } catch (err: any) {
      done(err, undefined)
    }
  })

  await registerHealthRoute(app)
  await registerBlingWebhooks(app)
  await registerWmsWebhooks(app)

  // Workers
  const workers = [
    createBlingInWorker(),
    createBlingOutWorker(),
    createWmsInWorker(),
    createWmsOutWorker(),
  ]

  // Stalled queue alert: check bling_out every minute during business hours (8-20)
  cron.schedule('* 8-20 * * 1-5', async () => {
    const counts = await queues.bling_out.getJobCounts('active', 'waiting')
    if (counts.active === 0 && counts.waiting === 0) {
      const { rows } = await (await import('@syncstock/core')).query(
        `SELECT COUNT(*) FROM events
         WHERE queue_name = 'bling_out' AND status = 'success'
           AND processed_at > NOW() - INTERVAL '1 minute'`
      )
      if (parseInt(rows[0].count, 10) === 0) {
        console.warn('[alert] bling_out queue: 0 jobs processed in last minute during business hours')
      }
    }
  })

  // Reconciliation cron every 30 minutes
  cron.schedule('*/30 * * * *', async () => {
    try {
      await runReconciliation(RECONCILIATION_COMPANY_ID)
    } catch (err) {
      console.error('[cron] reconciliation failed', err)
    }
  })

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[shutdown] ${signal} received`)
    await app.close()
    await Promise.all(workers.map((w) => w.close()))
    await redis.quit()
    process.exit(0)
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ port: PORT, host: '0.0.0.0' })
  console.log(`[middleware] listening on :${PORT}`)
}

main().catch((err) => {
  console.error('[startup] fatal error', err)
  process.exit(1)
})
