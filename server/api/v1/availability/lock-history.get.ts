import { listAvailabilityLockEvents } from '../../../../core/roster/lockHistory.mjs'
import { assertDate } from '../../../utils/dates'

// Manager-visible lock/unlock log. roster:read is the same scope as viewing
// team availability; assertTeamReach stops a rank-and-file staff member with
// roster:read from listing everyone else's lock activity (a scope check
// alone is not an identity check — see CLAUDE.md).
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  assertTeamReach(ctx, 'Availability lock history')
  const q = getQuery(event)
  const from = assertDate(q.from, 'from')
  const to = assertDate(q.to, 'to')
  if (from > to) throw apiError(400, 'from must be on or before to')

  try {
    const data = await listAvailabilityLockEvents(getAdminClient(), ctx.workspaceId, {
      storeId: q.store_id ? String(q.store_id) : undefined,
      from,
      to,
      limit: q.limit != null ? Number(q.limit) : 200,
    })
    return { data, total: data.length }
  } catch (err: any) {
    throw apiError(500, err?.message || 'Could not load lock history')
  }
})
