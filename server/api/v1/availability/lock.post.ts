import { setAvailabilityLocks } from '../../../../core/roster/query.mjs'
import { assertDate } from '../../../utils/dates'

// Manager lock/unlock of a staff member's availability for specific dates.
// Independent of the automatic cutoff. Only roster:write may call this —
// staff cannot lock their own dates.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const staffId = String(body?.staff_id || '').trim()
  if (!staffId) throw apiError(400, 'staff_id is required')
  if (typeof body?.locked !== 'boolean') throw apiError(400, 'locked must be true or false')

  const rawDates = Array.isArray(body?.dates) ? body.dates : []
  const dates = rawDates.map((d: unknown) => assertDate(d, 'dates'))

  try {
    const data = await setAvailabilityLocks(db, ctx.workspaceId, {
      staffId, dates, locked: body.locked,
      lockedBy: ctx.kind === 'session' ? ctx.staff.id : null,
    }, {
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    })
    return { data, ok: true }
  } catch (err: any) {
    const msg = err?.message || 'Could not update the lock'
    throw apiError(/not found/i.test(msg) ? 404 : 400, msg)
  }
})
