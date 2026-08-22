import { deleteStaffRecord } from '../../../../core/staff/profile.mjs'

// Dummy staff: hard-delete (needs staff:dummy). Real staff: refuse unless
// ?mode=terminate (or body.mode), which soft-terminates so timesheets and
// audit survive (needs staff:write).
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  const id = getRouterParam(event, 'id')
  const db = getAdminClient()
  const { data: target } = await db.from('staff').select('id, is_dummy')
    .eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  if (!target) throw apiError(404, 'Staff not found')

  const needed = target.is_dummy ? 'staff:dummy' : 'staff:write'
  if (!ctx.has(needed)) throw denied(needed, { scopes: ctx.scopes, role: ctx.role, kind: ctx.kind, name: ctx.actorName })

  const q = getQuery(event)
  const body = await readBody(event).catch(() => ({})) || {}
  const mode = String(body.mode || q.mode || 'legacy')
  try {
    return await deleteStaffRecord(db, ctx.workspaceId, id, {
      mode,
      actor: {
        workspace_id: ctx.workspaceId,
        actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
        actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
      },
    })
  } catch (err: any) {
    const msg = err?.message || 'Could not delete staff'
    throw apiError(/Only dummy|not found|No staff/i.test(msg) ? 403 : 400, msg)
  }
})
