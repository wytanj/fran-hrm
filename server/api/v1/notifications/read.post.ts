import { markAllRead, markRead } from '../../../../core/notifications/record.mjs'

// Mark my notifications read. Omit `ids` (or pass null) to mark all; an
// explicit list marks only those. Always pinned to the caller's own staff_id.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (ctx.kind !== 'session') {
    throw apiError(400, 'Notifications are a staff-session endpoint (the signed-in person\'s own inbox)')
  }
  const body = await readBody(event)
  const db = getAdminClient()
  try {
    if (Array.isArray(body?.ids)) {
      await markRead(db, ctx.workspaceId, ctx.staff.id, body.ids)
    } else {
      await markAllRead(db, ctx.workspaceId, ctx.staff.id)
    }
    return { ok: true }
  } catch (err: any) {
    throw apiError(500, err?.message || 'Could not mark notifications read')
  }
})
