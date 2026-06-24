import { FastifyInstance } from 'fastify'
import { authMiddleware } from '../auth/jwt'
import {
  listMappingsByStatus,
  approveMapping,
  rejectMapping,
  upsertMappingCandidate,
} from '../../../middleware/src/services/mapping.service'
import { MappingStatus } from '@syncstock/core'

export async function registerMappingRoutes(app: FastifyInstance): Promise<void> {
  app.get(
    '/mappings',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const { status = 'pending', companyId } = req.query as { status?: string; companyId?: string }
      const validStatuses: MappingStatus[] = ['pending', 'approved', 'quarantine']
      if (!validStatuses.includes(status as MappingStatus)) {
        return reply.code(400).send({ error: `status must be one of: ${validStatuses.join(', ')}` })
      }
      const items = await listMappingsByStatus(status as MappingStatus, companyId)
      return reply.send({ data: items, total: items.length })
    }
  )

  app.post<{ Params: { id: string } }>(
    '/mappings/:id/approve',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const actor = (req as any).jwtPayload?.sub ?? 'unknown'
      const mapping = await approveMapping(req.params.id, actor)
      return reply.send({ status: 'approved', data: mapping })
    }
  )

  app.post<{ Params: { id: string } }>(
    '/mappings/:id/reject',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const actor = (req as any).jwtPayload?.sub ?? 'unknown'
      await rejectMapping(req.params.id, actor)
      return reply.send({ status: 'rejected' })
    }
  )

  app.post<{
    Body: { skuBling: string; skuWms: string; companyId: string; confidence: number }
  }>(
    '/mappings',
    { preHandler: authMiddleware },
    async (req, reply) => {
      const { skuBling, skuWms, companyId, confidence } = req.body ?? {}
      if (!skuBling || !skuWms || !companyId || confidence === undefined) {
        return reply.code(400).send({ error: 'skuBling, skuWms, companyId, confidence are required' })
      }
      const mapping = await upsertMappingCandidate({ skuBling, skuWms, companyId, confidence })
      return reply.code(201).send({ data: mapping })
    }
  )
}
