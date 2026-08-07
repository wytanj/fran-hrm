// Set one cell of the role → permission matrix.
//
// Guardrails: hq_admin cannot have staff:write taken away, because that is the
// permission needed to grant it back — locking every admin out of their own
// permission screen is not a state we let an accidental click reach.
import { recordAudit } from '../../../../core/audit/record.mjs'
import { getAdminClient } from '../../../utils/supabase'
// @ts-ignore .mjs shared module
import { invalidatePermissionCache } from '../../../../core/permissions/resolve.mjs'
// @ts-ignore .mjs shared module
import { ROLES, SCOPE_KEYS, scopeMeta } from '../../../../core/permissions/catalog.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const role = String(body?.role || '')
  const scope = String(body?.scope || '')
  const allowed = !!body?.allowed

  if (!ROLES.includes(role)) throw apiError(400, `role must be one of: ${ROLES.join(', ')}`)
  if (!SCOPE_KEYS.includes(scope)) throw apiError(400, `Unknown permission "${scope}"`)

  if (role === 'hq_admin' && scope === 'staff:write' && !allowed) {
    throw apiError(422, 'HQ Admin must keep "Create and edit staff records" — it is the permission that lets anyone edit this matrix. Removing it would lock everyone out.')
  }

  const { data, error } = await db.from('role_permissions').upsert({
    workspace_id: ctx.workspaceId,
    role,
    scope,
    allowed,
    updated_at: new Date().toISOString(),
    updated_by: ctx.kind === 'session' ? ctx.staff.id : null,
  }, { onConflict: 'workspace_id,role,scope' }).select().single()
  if (error) throw apiError(400, error.message)

  invalidatePermissionCache(ctx.workspaceId)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId,
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'role_permissions', entity_id: data.id, operation: 'UPDATE',
    after_data: { role, scope, allowed },
    metadata: { action: allowed ? 'grant_role_permission' : 'revoke_role_permission', label: scopeMeta(scope)?.label },
  })

  return { data: { role, scope, allowed }, note: `${scopeMeta(scope)?.label || scope} ${allowed ? 'granted to' : 'removed from'} ${role}. Takes effect immediately, including through Claude.` }
})
