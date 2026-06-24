import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { buildIdempotencyKey } from '../services/idempotency.service'
import { queues, query } from '@syncstock/core'
import type { SmartgoWebhookBody } from '@syncstock/core'

/**
 * Smartgo WMS incoming webhooks.
 *
 * Security model (Smartgo sends no HMAC):
 *   1. nginx IP allowlist — only Smartgo's egress IPs can reach this path
 *   2. Secret token in URL — /webhooks/wms/:token  prevents guessing
 *
 * Smartgo timeout: 3 seconds. We MUST respond 200 before doing any work.
 * All processing happens asynchronously in the wms_in BullMQ worker.
 *
 * Idempotency key: SHA256('wms' | tipoEvento | codigoInterno)
 *   — business-level dedup, not GUID-based.
 *   — GUID stability across Smartgo retries is undocumented, so we don't use it.
 *   — Timestamp goes only in events.received_at, never in the key.
 */
export async function registerWmsWebhooks(app: FastifyInstance): Promise<void> {
  const expectedToken = process.env.WMS_WEBHOOK_TOKEN
  if (!expectedToken) throw new Error('WMS_WEBHOOK_TOKEN not set')

  app.post<{ Params: { token: string } }>(
    '/webhooks/wms/:token',
    async (req: FastifyRequest<{ Params: { token: string } }>, reply: FastifyReply) => {

      // ── 1. Token validation (constant-time compare not needed since it's not HMAC,
      //        but keep it simple — nginx allowlist is the primary guard) ──────────
      if (req.params.token !== expectedToken) {
        return reply.code(403).send({ error: 'Forbidden' })
      }

      const body = req.body as SmartgoWebhookBody

      if (!body?.tipoEvento || !body?.metadata?.codigoInterno) {
        // Acknowledge malformed payloads so Smartgo stops retrying them
        return reply.code(200).send({ status: 'ignored', reason: 'missing required fields' })
      }

      // ── 2. Only process expedition events ────────────────────────────────────
      const classificacao = body.classificacao?.toUpperCase()
      if (classificacao !== 'EXPEDICAO' && classificacao !== 'EXPEDICÃO') {
        return reply.code(200).send({ status: 'ignored', reason: 'non-expedition event' })
      }

      const tipoEvento    = body.tipoEvento.toUpperCase()
      const codigoInterno = body.metadata.codigoInterno

      // Only act on terminal states — informational events are acknowledged silently
      const actionableEvents = ['FINALIZADO', 'CANCELADO', 'ESTORNADO']
      if (!actionableEvents.includes(tipoEvento)) {
        return reply.code(200).send({ status: 'ignored', reason: `non-actionable tipoEvento: ${tipoEvento}` })
      }

      // ── 3. Idempotency — insert event row; ON CONFLICT = duplicate ────────────
      const idempotencyKey = buildIdempotencyKey('wms', tipoEvento, codigoInterno, '')
      const entityId       = codigoInterno
      const receivedAt     = new Date()

      const { rows } = await query<{ id: string }>(
        `INSERT INTO events
           (idempotency_key, origin, event_type, entity_id, payload, queue_name, received_at)
         VALUES ($1, 'wms', $2, $3, $4, 'wms_in', $5)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING id`,
        [idempotencyKey, tipoEvento, entityId, JSON.stringify(body), receivedAt]
      )

      // ── 4. Respond 200 immediately — MUST be within Smartgo's 3s timeout ─────
      if (rows.length === 0) {
        return reply.code(200).send({ status: 'duplicate' })
      }

      const eventId = rows[0].id

      // Enqueue AFTER sending reply (fire-and-forget in async handler)
      // Using setImmediate so the reply is flushed first
      setImmediate(() => {
        queues.wms_in
          .add(tipoEvento, {
            eventId,
            idempotencyKey,
            origin:         'wms',
            eventType:      tipoEvento,
            entityId,
            companyId:      body.docDepositante ?? DOC_DEP(),
            payload:        body,
          }, { jobId: idempotencyKey })
          .catch((err) => console.error('[wms webhook] enqueue failed', err))
      })

      return reply.code(200).send({ status: 'queued', eventId })
    }
  )
}

function DOC_DEP(): string {
  return process.env.WMS_DOC_DEPOSITANTE ?? ''
}
