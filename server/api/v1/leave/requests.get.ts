import { listLeaveRequests } from '../../../../core/leave/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'leave:read' })
  const q = getQuery(event)
  const staffId = limitToSelf(ctx, q.staff_id ? String(q.staff_id) : null)
  return listLeaveRequests(getAdminClient(), ctx.workspaceId, {
    staff_id: staffId,
    status: q.status ? String(q.status) : undefined,
    from: q.from ? String(q.from) : undefined,
    to: q.to ? String(q.to) : undefined,
    limit: q.limit,
  })
})
