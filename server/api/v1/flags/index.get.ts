import { listFlags } from '../../../../core/attendance/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'attendance:read' })
  const q = getQuery(event)
  const staffId = limitToSelf(ctx, q.staff_id ? String(q.staff_id) : null)
  // Without team reach, limitToSelf pins this to the requester's own flags.
  return listFlags(getAdminClient(), ctx.workspaceId, {
    staff_id: staffId,
    store_id: q.store_id ? String(q.store_id) : undefined,
    from: q.from ? String(q.from) : undefined,
    to: q.to ? String(q.to) : undefined,
    flag_type: q.flag_type ? String(q.flag_type) : undefined,
    status: q.status ? String(q.status) : undefined,
    limit: q.limit,
  })
})
