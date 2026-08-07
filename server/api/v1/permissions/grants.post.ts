// Grant or revoke a single permission for ONE person, optionally with an
// expiry — the "this supervisor publishes the Orchard roster" case, and the
// "acting manager while the SM is on leave" case.
//
// Pass allowed=null (or remove=true) to delete the override and fall back to
// whatever the person's role allows.
import { recordAudit } from '../../../../core/audit/record.mjs'
import { getAdminClient } from '../../../utils/supabase'
import { resolveStaff } from '../../../../core/staff/query.mjs'
// @ts-ignore .mjs shared module
import { SCOPE_KEYS, scopeMeta } from '../../../../core/permissions/catalog.mjs'
// @ts-ignore .mjs shared module
import { resolveStaffScopes } from '../../../../core/permissions/resolve.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const target = await resolveStaff(db, ctx.workspaceId, body?.staff_id || body?.staff)
  const scope = String(body?.scope || '')
  if (!SCOPE_KEYS.includes(scope)) throw apiError(400, `Unknown permission "${scope}"`)

  if (body?.remove === true || body?.allowed === null) {
    await db.from('staff_permission_grants').delete().eq('staff_id', target.id).eq('scope', scope)
    await recordAudit(db, {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
      object_type: 'staff_permission_grants', entity_id: target.id, operation: 'DELETE',
      metadata: { action: 'clear_permission_override', scope, staff: target.employee_code },
    })
    const after = await resolveStaffScopes(db, ctx.workspaceId, target)
    return { data: { removed: true, scope }, effective_scopes: after.scopes }
  }

  const allowed = body?.allowed !== false
  let expiresAt: string | null = null
  if (body?.expires_at) {
    const d = new Date(body.expires_at)
    if (Number.isNaN(d.getTime())) throw apiError(400, 'expires_at must be a date/time')
    if (d.getTime() < Date.now()) throw apiError(400, 'expires_at is already in the past')
    expiresAt = d.toISOString()
  }

  const { data, error } = await db.from('staff_permission_grants').upsert({
    workspace_id: ctx.workspaceId,
    staff_id: target.id,
    scope,
    allowed,
    reason: body?.reason || null,
    expires_at: expiresAt,
    granted_by: ctx.kind === 'session' ? ctx.staff.id : null,
  }, { onConflict: 'staff_id,scope' }).select().single()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId,
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'staff_permission_grants', entity_id: data.id, operation: 'INSERT',
    after_data: data,
    metadata: {
      action: allowed ? 'grant_permission_to_person' : 'revoke_permission_from_person',
      scope, staff: target.employee_code, expires_at: expiresAt,
    },
  })

  const after = await resolveStaffScopes(db, ctx.workspaceId, target)
  return {
    data,
    effective_scopes: after.scopes,
    note: `${scopeMeta(scope)?.label || scope} ${allowed ? 'granted to' : 'revoked from'} ${target.display_name}${expiresAt ? ` until ${expiresAt.slice(0, 10)}` : ''}.`,
  }
})
