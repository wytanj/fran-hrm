import { recordAudit } from '../../../../core/audit/record.mjs'

// Exit "view as": restore the manager's own session. No scope check beyond
// the stashed cookie itself — only startViewAs (staff:write) could have set
// it, and it is an unguessable, httpOnly, server-issued token.
export default defineEventHandler(async (event) => {
  const leaving = await getSessionStaff(event)
  await endViewAs(event)
  const restored = await getSessionStaff(event)

  if (restored) {
    await recordAudit(getAdminClient(), {
      workspace_id: restored.workspace_id, actor_kind: 'user', actor_id: restored.id, actor_name: restored.display_name,
      source_type: 'web', object_type: 'staff_view_as', entity_id: leaving?.id || null, operation: 'END',
      after_data: { was_viewing: leaving?.employee_code || null },
    })
  }

  return { ok: true, staff: restored ? { id: restored.id, display_name: restored.display_name, employee_code: restored.employee_code } : null }
})
