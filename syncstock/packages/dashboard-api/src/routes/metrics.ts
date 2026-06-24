import { FastifyInstance } from 'fastify'
import { query } from '@syncstock/core'
import { authMiddleware } from '../auth/jwt'

export async function registerMetricsRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/metrics/summary',
    { preHandler: authMiddleware },
    async (_req, reply) => {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

      const [totals, lag, dlqCount, mappingCounts, divergences] = await Promise.all([
        query<{ status: string; count: string }>(
          `SELECT status, COUNT(*) AS count FROM events
           WHERE received_at > $1 GROUP BY status`,
          [since]
        ),
        query<{ queue_name: string; avg_ms: string; p95_ms: string }>(
          `SELECT queue_name,
                  AVG(EXTRACT(EPOCH FROM (processed_at - received_at)) * 1000) AS avg_ms,
                  PERCENTILE_CONT(0.95) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (processed_at - received_at)) * 1000
                  ) AS p95_ms
           FROM events
           WHERE status = 'success'
             AND processed_at IS NOT NULL
             AND received_at > $1
             AND queue_name IN ('bling_out','wms_out')
           GROUP BY queue_name`,
          [since]
        ),
        query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM dead_letter_queue WHERE resolved_at IS NULL`
        ),
        query<{ status: string; count: string }>(
          `SELECT status, COUNT(*) AS count FROM product_mappings GROUP BY status`
        ),
        query<{ sku: string; company_id: string; balance_bling: number; balance_wms: number }>(
          `SELECT sku, company_id, balance_bling, balance_wms
           FROM stock_snapshots
           WHERE balance_bling <> balance_wms
           ORDER BY ABS(balance_bling - balance_wms) DESC
           LIMIT 20`
        ),
      ])

      const statusMap: Record<string, number> = {}
      for (const row of totals.rows) statusMap[row.status] = parseInt(row.count, 10)

      const total = Object.values(statusMap).reduce((a, b) => a + b, 0)
      const success = statusMap['success'] ?? 0
      const successRate = total > 0 ? ((success / total) * 100).toFixed(2) : '100.00'

      const lagMap: Record<string, { avgMs: number | null; p95Ms: number | null }> = {}
      for (const row of lag.rows) {
        lagMap[row.queue_name] = {
          avgMs: row.avg_ms ? parseFloat(row.avg_ms) : null,
          p95Ms: row.p95_ms ? parseFloat(row.p95_ms) : null,
        }
      }

      const mappingMap: Record<string, number> = {}
      for (const row of mappingCounts.rows) mappingMap[row.status] = parseInt(row.count, 10)

      return reply.send({
        period: '24h',
        events: {
          total,
          byStatus: statusMap,
          successRate: parseFloat(successRate),
        },
        lag: lagMap,
        dlq: { open: parseInt(dlqCount.rows[0]?.count ?? '0', 10) },
        mappings: mappingMap,
        divergences: divergences.rows.map((r) => ({
          sku: r.sku,
          companyId: r.company_id,
          balanceBling: r.balance_bling,
          balanceWms: r.balance_wms,
          diff: r.balance_bling - r.balance_wms,
        })),
        lagThresholdMs: 300_000,
      })
    }
  )

  app.get(
    '/metrics/lag-history',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const { hours = '6' } = req.query as { hours?: string }
      const since = new Date(Date.now() - parseInt(hours, 10) * 60 * 60 * 1000).toISOString()

      const { rows } = await query(
        `SELECT
           DATE_TRUNC('minute', received_at) AS bucket,
           queue_name,
           AVG(EXTRACT(EPOCH FROM (processed_at - received_at)) * 1000) AS avg_ms,
           COUNT(*) AS event_count
         FROM events
         WHERE status = 'success'
           AND processed_at IS NOT NULL
           AND received_at > $1
         GROUP BY bucket, queue_name
         ORDER BY bucket ASC`,
        [since]
      )

      return reply.send({ data: rows })
    }
  )

  app.get(
    '/metrics/divergences',
    { preHandler: authMiddleware },
    async (_req, reply) => {
      const { rows } = await query(
        `SELECT s.sku, s.company_id, s.balance_bling, s.balance_wms,
                s.balance_bling - s.balance_wms AS diff,
                s.last_reconciled_at
         FROM stock_snapshots s
         WHERE s.balance_bling <> s.balance_wms
         ORDER BY ABS(s.balance_bling - s.balance_wms) DESC
         LIMIT 100`
      )
      return reply.send({ data: rows })
    }
  )
}
