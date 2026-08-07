// The permission matrix plus everyone's personal overrides, for the admin
// screen. Also returns the caller's own effective scopes so the UI can explain
// why a button is missing.
import { getAdminClient } from '../../../utils/supabase'
// @ts-ignore .mjs shared module
import { describeMatrix } from '../../../../core/permissions/resolve.mjs'
// @ts-ignore .mjs shared module
import { ROLES, ROLE_LABELS, SCOPES, SENSITIVE_SCOPES } from '../../../../core/permissions/catalog.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:read' })
  const db = getAdminClient()

  const { configured, matrix } = await describeMatrix(db, ctx.workspaceId)

  const { data: grants } = await db
    .from('staff_permission_grants')
    .select('scope, allowed, reason, expires_at, created_at, staff:staff_id(id, employee_code, display_name, role), granter:granted_by(display_name)')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })

  const now = Date.now()
  return {
    data: {
      configured,
      roles: ROLES.map((r: string) => ({ role: r, label: ROLE_LABELS[r] })),
      scopes: SCOPES,
      sensitive: SENSITIVE_SCOPES,
      matrix,
      grants: (grants || []).map((g: any) => ({
        staff_id: g.staff?.id,
        employee_code: g.staff?.employee_code,
        display_name: g.staff?.display_name,
        role: g.staff?.role,
        scope: g.scope,
        allowed: g.allowed,
        reason: g.reason,
        expires_at: g.expires_at,
        expired: Boolean(g.expires_at && new Date(g.expires_at).getTime() < now),
        granted_by: g.granter?.display_name || null,
      })),
      // Whoever is looking, so the UI can show "you have / you don't".
      my_scopes: ctx.scopes,
      my_role: ctx.role,
      my_overrides: ctx.overrides,
      can_edit: ctx.has('staff:write'),
    },
  }
})
