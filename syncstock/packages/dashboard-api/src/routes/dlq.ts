import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/jwt'
import { listOpenDlqItems, reprocessDlqItem, discardDlqItem } from '../../../middleware/src/services/dlq.service'
import { query } from '@syncstock/core'

export async function registerDlqRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/dlq',
    { preHandler: authMiddleware },
    async (_req, reply) => {
      const items = await listOpenDlqItems()
      return reply.send({ data: items, total: items.length })
    }
  )

  app.post<{ Params: { id: string } }>(
    '/dlq/:id/reprocess',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const actor = (req as any).jwtPayload?.sub ?? 'unknown'
      await reprocessDlqItem(req.params.id, actor)
      return reply.send({ status: 'reprocessed' })
    }
  )

  app.post<{ Params: { id: string }; Body: { reason: string } }>(
    '/dlq/:id/discard',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const actor = (req as any).jwtPayload?.sub ?? 'unknown'
      const reason = req.body?.reason
      if (!reason?.trim()) {
        return reply.code(400).send({ error: 'reason is required to discard a DLQ item' })
      }
      await discardDlqItem(req.params.id, reason, actor)
      return reply.send({ status: 'discarded' })
    }
  )

  app.get(
    '/dlq/history',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const { limit = '50' } = req.query as { limit?: string }
      const { rows } = await query(
        `SELECT * FROM dead_letter_queue
         WHERE resolved_at IS NOT NULL
         ORDER BY resolved_at DESC
         LIMIT $1`,
        [Math.min(parseInt(limit, 10), 200)]
      )
      return reply.send({ data: rows })
    }
  )

  app.get(
    '/audit',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const { entityType, entityId, limit = '100' } = req.query as Record<string, string>
      const conditions: string[] = []
      const values: unknown[] = []

      if (entityType) { conditions.push(`entity_type = $${values.length + 1}`); values.push(entityType) }
      if (entityId)   { conditions.push(`entity_id = $${values.length + 1}`);   values.push(entityId) }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const { rows } = await query(
        `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT $${values.length + 1}`,
        [...values, Math.min(parseInt(limit, 10), 500)]
      )
      return reply.send({ data: rows })
    }
  )
}
