import { FastifyInstance } from 'fastify'
import { checkConnection, checkRedisConnection, HealthStatus } from '@syncstock/core'
import { checkBlingHealth } from './adapters/bling.adapter'
import { checkWmsHealth } from './adapters/wms.adapter'

const LAG_ALERT_MS = parseInt(process.env.LAG_ALERT_MS ?? String(5 * 60 * 1000), 10)

export async function registerHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_req, reply) => {
    const [postgres, redisOk, blingOk, wmsOk] = await Promise.allSettled([
      checkConnection(),
      checkRedisConnection(),
      checkBlingHealth(),
      checkWmsHealth(),
    ])

    const checks: HealthStatus['checks'] = {
      postgres: settled(postgres) ? 'ok' : 'error',
      redis: settled(redisOk) ? 'ok' : 'error',
      bling_api: settled(blingOk) ? 'ok' : 'error',
      wms: settled(wmsOk) ? 'ok' : 'error',
    }

    const queueLag = await getQueueLag()

    const overallDown = checks.postgres === 'error' || checks.redis === 'error'
    const overallDegraded =
      checks.bling_api === 'error' ||
      checks.wms === 'error' ||
      (queueLag.bling_out_avg_ms !== null && queueLag.bling_out_avg_ms > LAG_ALERT_MS) ||
      (queueLag.wms_out_avg_ms !== null && queueLag.wms_out_avg_ms > LAG_ALERT_MS)

    const status: HealthStatus = {
      status: overallDown ? 'down' : overallDegraded ? 'degraded' : 'ok',
      checks,
      queueLag,
      version: process.env.npm_package_version ?? '1.0.0',
      uptime: process.uptime(),
    }

    return reply.code(status.status === 'down' ? 503 : 200).send(status)
  })
}

async function getQueueLag(): Promise<HealthStatus['queueLag']> {
  try {
    const { query } = await import('@syncstock/core')

    const { rows } = await query<{ queue_name: string; avg_ms: string }>(
      `SELECT queue_name, AVG(
         EXTRACT(EPOCH FROM (processed_at - received_at)) * 1000
       ) AS avg_ms
       FROM events
       WHERE status = 'success'
         AND processed_at IS NOT NULL
         AND received_at > NOW() - INTERVAL '10 minutes'
         AND queue_name IN ('bling_out', 'wms_out')
       GROUP BY queue_name`
    )

    const lag: HealthStatus['queueLag'] = { bling_out_avg_ms: null, wms_out_avg_ms: null }
    for (const row of rows) {
      if (row.queue_name === 'bling_out') lag.bling_out_avg_ms = parseFloat(row.avg_ms)
      if (row.queue_name === 'wms_out') lag.wms_out_avg_ms = parseFloat(row.avg_ms)
    }
    return lag
  } catch {
    return { bling_out_avg_ms: null, wms_out_avg_ms: null }
  }
}

function settled(result: PromiseSettledResult<boolean>): boolean {
  return result.status === 'fulfilled' && result.value === true
}
