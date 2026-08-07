import bcrypt from 'bcryptjs'
import { resolveStaff, compactStaff } from '../../../../core/staff/query.mjs'
import { recordAudit } from '../../../../core/audit/record.mjs'

const EDITABLE = [
  'display_name', 'email', 'phone', 'role', 'employment_type', 'employment_status',
  'home_store_id', 'hourly_rate_cents', 'pt_weekly_hour_cap', 'pt_monthly_hour_cap',
  'hired_on', 'terminated_on', 'pos_access_enabled',
]

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const db = getAdminClient()
  const before = await resolveStaff(db, ctx.workspaceId, getRouterParam(event, 'id'))
  const body = await readBody(event)

  const patch: Record<string, any> = {}
  for (const k of EDITABLE) if (body[k] !== undefined) patch[k] = body[k]
  if (body.pin) {
    if (!/^\d{4,12}$/.test(String(body.pin))) throw apiError(400, 'PIN must be 4-12 digits')
    patch.pin_hash = bcrypt.hashSync(String(body.pin), 10)
    patch.failed_attempts = 0
    patch.locked_until = null
  }
  // Terminating/deactivating revokes POS access; re-activation never
  // auto-restores it (fran-pos "local POS authority" doctrine).
  if (['terminated', 'inactive'].includes(patch.employment_status)) patch.pos_access_enabled = false
  patch.updated_at = new Date().toISOString()

  const { data, error } = await db.from('staff').update(patch).eq('id', before.id).select().single()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'staff', entity_id: data.id, operation: 'UPDATE',
    before_data: compactStaff(before), after_data: compactStaff(data),
  })
  return { data: compactStaff(data, { includeRate: true }) }
})
