import { getLeaveBalances } from '../../../../core/leave/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'leave:read' })
  const q = getQuery(event)
  const staffId = limitToSelf(ctx, q.staff_id ? String(q.staff_id) : null) || (ctx.kind === 'session' ? ctx.staff.id : null)
  if (!staffId) throw apiError(400, 'staff_id is required')
  const data = await getLeaveBalances(getAdminClient(), ctx.workspaceId, { staff_id: staffId, year: q.year })
  return { data, staff_id: staffId }
})
