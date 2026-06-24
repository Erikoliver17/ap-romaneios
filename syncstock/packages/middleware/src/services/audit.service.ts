import { query } from '@syncstock/core'

export interface AuditParams {
  action: string
  entityType: string
  entityId: string
  actor: string
  payload?: Record<string, unknown>
}

export async function writeAuditLog(params: AuditParams): Promise<void> {
  await query(
    `INSERT INTO audit_log (action, entity_type, entity_id, actor, payload)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      params.action,
      params.entityType,
      params.entityId,
      params.actor,
      params.payload ? JSON.stringify(params.payload) : null,
    ]
  )
}
