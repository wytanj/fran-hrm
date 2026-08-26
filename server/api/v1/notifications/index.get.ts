import { listNotifications } from '../../../../core/notifications/record.mjs'

// Self-scoped inbox: always the signed-in staff member's own rows. No
// team-reach check — like clock status, this is "my notifications".
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (ctx.kind !== 'session') {
    throw apiError(400, 'Notifications are a staff-session endpoint (the signed-in person\'s own inbox)')
  }
  const q = getQuery(event)
  const unreadOnly = q.unread_only === 'true' || q.unread_only === '1'
  const limit = q.limit != null ? Number(q.limit) : 20
  try {
    return await listNotifications(getAdminClient(), ctx.workspaceId, ctx.staff.id, { unreadOnly, limit })
  } catch (err: any) {
    throw apiError(500, err?.message || 'Could not load notifications')
  }
})
