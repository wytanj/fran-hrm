import { recordAudit } from '../../../../core/audit/record.mjs'

// Remove ALL dummy (test) staff at once — the reset button after an E2E run.
// Scoped strictly to is_dummy, so real staff are never touched.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const db = getAdminClient()

  const { data: dummies } = await db
    .from('staff').select('id, employee_code')
    .eq('workspace_id', ctx.workspaceId).eq('is_dummy', true)
  const ids = (dummies || []).map((d: any) => d.id)
  if (!ids.length) return { ok: true, removed: 0 }

  await db.from('shifts').delete().eq('workspace_id', ctx.workspaceId).in('staff_id', ids)
  const { error } = await db.from('staff').delete().eq('workspace_id', ctx.workspaceId).eq('is_dummy', true)
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'staff', entity_id: null, operation: 'DELETE',
    metadata: { action: 'purge_all_dummy_staff', removed: ids.length, codes: (dummies || []).map((d: any) => d.employee_code) },
  })
  return { ok: true, removed: ids.length }
})
