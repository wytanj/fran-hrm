// Weekly timesheet sign-off status per store, with overdue flags. Read-only
// manager view (store-wide), so reports:read + team reach.
// @ts-ignore .mjs shared module
import { listTimesheetWeeks } from '../../../../core/attendance/signoff.mjs'
import { assertDate } from '../../../utils/dates'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'reports:read' })
  assertTeamReach(ctx, 'Timesheet sign-off status')
  const q = getQuery(event)
  const db = getAdminClient()
  const from = assertDate(q.from, 'from')
  const to = assertDate(q.to, 'to')

  const result = await listTimesheetWeeks(db, ctx.workspaceId, {
    storeId: q.store_id ? String(q.store_id) : undefined,
    from,
    to,
  })
  return { data: result.weeks, overdue_count: result.overdue_count, from, to }
})
