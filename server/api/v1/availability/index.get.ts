import { listAvailability } from '../../../../core/roster/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const q = getQuery(event)
  const staffId = limitToSelf(ctx, q.staff_id ? String(q.staff_id) : null)
  const data = await listAvailability(getAdminClient(), ctx.workspaceId, {
    staff_id: staffId,
    from: q.from ? String(q.from) : undefined,
    to: q.to ? String(q.to) : undefined,
  })
  return { data }
})
