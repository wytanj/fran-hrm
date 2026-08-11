import { recordAudit } from '../../../../core/audit/record.mjs'

// Hard-delete a DUMMY test staff member and their test footprint. Real staff
// are never hard-deleted here (they are terminated via PATCH so timesheets and
// audit history survive) — this refuses anything without is_dummy.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const db = getAdminClient()
  const id = getRouterParam(event, 'id')

  const { data: st } = await db
    .from('staff').select('id, display_name, employee_code, is_dummy')
    .eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  if (!st) throw apiError(404, 'Staff not found')
  if (!st.is_dummy) {
    throw apiError(403, 'Only dummy (test) staff can be deleted. Real staff are terminated via their record, never hard-deleted — that preserves their timesheets and the audit trail.')
  }

  // Their shifts are ON DELETE SET NULL (would linger as open shifts), so clear
  // them explicitly; every other dependent row (time entries, clock events,
  // availability, leave, corrections, flags, sessions, grants, assignments,
  // connections) is ON DELETE CASCADE and goes with the row.
  await db.from('shifts').delete().eq('workspace_id', ctx.workspaceId).eq('staff_id', st.id)
  const { error } = await db.from('staff').delete().eq('workspace_id', ctx.workspaceId).eq('id', st.id).eq('is_dummy', true)
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'staff', entity_id: st.id, operation: 'DELETE',
    before_data: { employee_code: st.employee_code, display_name: st.display_name, is_dummy: true },
    metadata: { action: 'purge_dummy_staff' },
  })
  return { ok: true, deleted: st.employee_code }
})
