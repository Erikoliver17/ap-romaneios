import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { validateBlingSignature } from '../adapters/bling.adapter'
import { buildIdempotencyKey } from '../services/idempotency.service'
import { queues, query, BlingWebhookBody } from '@syncstock/core'

export async function registerBlingWebhooks(app: FastifyInstance): Promise<void> {
  app.post(
    '/webhooks/bling',
    {
      config: { rawBody: true },
    },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const signature = req.headers['x-bling-signature'] as string | undefined
      const rawBody = (req as any).rawBody as string

      if (!signature) {
        return reply.code(401).send({ error: 'Missing X-Bling-Signature' })
      }

      if (!validateBlingSignature(rawBody, signature)) {
        return reply.code(401).send({ error: 'Invalid signature' })
      }

      const body = req.body as BlingWebhookBody

      if (!body?.event || !body?.data) {
        return reply.code(400).send({ error: 'Malformed payload' })
      }

      const companyId = String(body.data.pedido?.empresa?.id ?? '1')
      const entityId = body.data.pedido?.numero ?? body.data.produto?.id?.toString() ?? 'unknown'

      // version = retries field from Bling ensures same retry → same key
      const version = String(body.retries ?? '0')
      const idempotencyKey = buildIdempotencyKey('bling', body.event, entityId, version)

      const { rows } = await query<{ id: string }>(
        `INSERT INTO events
           (idempotency_key, origin, event_type, entity_id, payload, queue_name)
         VALUES ($1, 'bling', $2, $3, $4, 'bling_in')
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [idempotencyKey, body.event, entityId, JSON.stringify(body)]
      )

      if (rows.length === 0) {
        // Duplicate — already queued
        return reply.code(200).send({ status: 'duplicate' })
      }

      const eventId = rows[0].id

      await queues.bling_in.add(
        body.event,
        {
          eventId,
          idempotencyKey,
          origin: 'bling',
          eventType: body.event,
          entityId,
          companyId,
          payload: body,
        },
        { jobId: idempotencyKey }
      )

      return reply.code(202).send({ status: 'queued', eventId })
    }
  )
}
