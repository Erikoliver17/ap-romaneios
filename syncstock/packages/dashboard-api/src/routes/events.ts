import { FastifyInstance } from 'fastify'
import { query } from '@syncstock/core'
import { authMiddleware } from '../auth/jwt'

export async function registerEventRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/events',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const { origin, status, limit = '50', offset = '0' } = req.query as Record<string, string>

      const conditions: string[] = []
      const values: unknown[] = []

      if (origin) {
        conditions.push(`origin = $${values.length + 1}`)
        values.push(origin)
      }
      if (status) {
        conditions.push(`status = $${values.length + 1}`)
        values.push(status)
      }

      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
      const limitVal = Math.min(parseInt(limit, 10), 200)
      const offsetVal = parseInt(offset, 10)

      const { rows } = await query(
        `SELECT id, origin, event_type, entity_id, status, retry_count,
                received_at, processed_at, error_message, queue_name,
                EXTRACT(EPOCH FROM (processed_at - received_at)) * 1000 AS lag_ms
         FROM events
         ${where}
         ORDER BY received_at DESC
         LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limitVal, offsetVal]
      )

      return reply.send({ data: rows, limit: limitVal, offset: offsetVal })
    }
  )

  app.get(
    '/events/:id',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const { id } = req.params as { id: string }
      const { rows } = await query(`SELECT * FROM events WHERE id = $1`, [id])
      if (rows.length === 0) return reply.code(404).send({ error: 'Not found' })
      return reply.send(rows[0])
    }
  )
}
