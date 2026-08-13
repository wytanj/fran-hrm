import { deleteStaffRecord } from '../../../../core/staff/profile.mjs'

// Dummy staff: hard-delete. Real staff: refuse unless ?mode=terminate
// (or body.mode), which soft-terminates so timesheets and audit survive.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const q = getQuery(event)
  const body = await readBody(event).catch(() => ({})) || {}
  const mode = String(body.mode || q.mode || 'legacy')
  try {
    return await deleteStaffRecord(getAdminClient(), ctx.workspaceId, getRouterParam(event, 'id'), {
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
