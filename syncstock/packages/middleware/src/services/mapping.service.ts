import { query, ProductMapping, MappingStatus } from '@syncstock/core'
import { writeAuditLog } from './audit.service'

const QUARANTINE_THRESHOLD = 0.70

export async function findApprovedMapping(
  skuBling: string,
  companyId: string
): Promise<ProductMapping | null> {
  const { rows } = await query<ProductMapping>(
    `SELECT * FROM product_mappings
     WHERE sku_bling = $1 AND company_id = $2 AND status = 'approved'
     LIMIT 1`,
    [skuBling, companyId]
  )
  return rows[0] ?? null
}

export async function upsertMappingCandidate(params: {
  skuBling: string
  skuWms: string
  companyId: string
  confidence: number
}): Promise<ProductMapping> {
  const status: MappingStatus = params.confidence < QUARANTINE_THRESHOLD
    ? 'quarantine'
    : 'pending'

  const quarantineReason = status === 'quarantine'
    ? `Confidence ${(params.confidence * 100).toFixed(0)}% below threshold of ${QUARANTINE_THRESHOLD * 100}%`
    : null

  const { rows } = await query<ProductMapping>(
    `INSERT INTO product_mappings
       (sku_bling, sku_wms, company_id, status, confidence, quarantine_reason)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (sku_bling, company_id) DO UPDATE
       SET sku_wms           = EXCLUDED.sku_wms,
           confidence        = EXCLUDED.confidence,
           quarantine_reason = EXCLUDED.quarantine_reason,
           status            = CASE
             WHEN product_mappings.status = 'approved' THEN 'approved'
             ELSE EXCLUDED.status
           END,
           updated_at        = NOW()
     RETURNING *`,
    [
      params.skuBling,
      params.skuWms,
      params.companyId,
      status,
      params.confidence,
      quarantineReason,
    ]
  )
  return rows[0]
}

export async function approveMapping(
  id: string,
  actor: string
): Promise<ProductMapping> {
  const { rows } = await query<ProductMapping>(
    `UPDATE product_mappings
     SET status = 'approved', approved_by = $2, approved_at = NOW(), updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, actor]
  )
  if (rows.length === 0) throw new Error(`Mapping ${id} not found`)

  await writeAuditLog({
    action: 'mapping_approved',
    entityType: 'product_mappings',
    entityId: id,
    actor,
    payload: { skuBling: rows[0].sku_bling, skuWms: rows[0].sku_wms } as unknown as Record<string, unknown>,
  })

  return rows[0]
}

export async function rejectMapping(
  id: string,
  actor: string
): Promise<void> {
  await query(
    `UPDATE product_mappings
     SET status = 'quarantine',
         quarantine_reason = 'Rejected by operator',
         updated_at = NOW()
     WHERE id = $1`,
    [id, actor]
  )

  await writeAuditLog({
    action: 'mapping_rejected',
    entityType: 'product_mappings',
    entityId: id,
    actor,
  })
}

export async function listMappingsByStatus(
  status: MappingStatus,
  companyId?: string
): Promise<ProductMapping[]> {
  const conditions: string[] = ['status = $1']
  const values: unknown[] = [status]

  if (companyId) {
    conditions.push(`company_id = $${values.length + 1}`)
    values.push(companyId)
  }

  const { rows } = await query<ProductMapping>(
    `SELECT * FROM product_mappings WHERE ${conditions.join(' AND ')}
     ORDER BY created_at DESC LIMIT 200`,
    values
  )
  return rows
}
