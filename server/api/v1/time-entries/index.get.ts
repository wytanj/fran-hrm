import { listTimeEntries } from '../../../../core/attendance/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'attendance:read' })
  const q = getQuery(event)
  const staffId = limitToSelf(ctx, q.staff_id ? String(q.staff_id) : null)
  return listTimeEntries(getAdminClient(), ctx.workspaceId, {
    staff_id: staffId,
    store_id: q.store_id ? String(q.store_id) : undefined,
    from: q.from ? String(q.from) : undefined,
    to: q.to ? String(q.to) : undefined,
    limit: q.limit,
  })
})
