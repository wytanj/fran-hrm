import { recordAudit } from '../../../../../core/audit/record.mjs'

// Manager-only: temporarily swap the active session to a dummy staff member
// so a manager can see the app exactly as that (fabricated) person would —
// their roster, availability, etc. Never permitted for a real staff member;
// that would be impersonation, not a preview.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  if (ctx.kind !== 'session') throw apiError(400, 'Sign in as a person to use View as.')

  const id = getRouterParam(event, 'id')
  const db = getAdminClient()
  const { data: target } = await db.from('staff')
    .select('id, workspace_id, is_dummy, display_name, employee_code, employment_status')
    .eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  if (!target) throw apiError(404, 'Staff not found')
  if (!target.is_dummy) throw apiError(403, 'View as only works for dummy staff — never a real person.')
  if (target.employment_status !== 'active') throw apiError(400, 'This dummy is not active.')

  await startViewAs(event, target)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: 'user', actor_id: ctx.actorId, actor_name: ctx.actorName,
    source_type: ctx.sourceType, object_type: 'staff_view_as', entity_id: target.id, operation: 'START',
    after_data: { as: target.employee_code, display_name: target.display_name },
  })

  return { ok: true, staff: { id: target.id, display_name: target.display_name, employee_code: target.employee_code } }
})
