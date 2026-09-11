import { buildObservation } from '../../../../core/scheduling/observation.mjs'
import { getWorkspaceSchedulingRules, assertMonth, addMonths, sgToday } from '../../../../core/scheduling/rules.mjs'

// Truth panel: submitted / missing / locked / published for one roster
// month. Team-wide by nature, so it needs team reach on top of roster:read
// (a part-timer must not see who else has or has not submitted).
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  assertTeamReach(ctx, 'The scheduling truth panel')
  const q = getQuery(event)
  const db = getAdminClient()

  let month: string
  try {
    month = q.month ? assertMonth(String(q.month)) : addMonths(sgToday().slice(0, 7), 1)
  } catch (err: any) {
    throw apiError(400, err.message)
  }
  const storeId = q.store_id ? String(q.store_id) : null
  const { rules, version } = await getWorkspaceSchedulingRules(db, ctx.workspaceId)
  try {
    const data = await buildObservation(db, ctx.workspaceId, { month, store_id: storeId, rules })
    return { data, rules_version: version }
  } catch (err: any) {
    throw apiError(500, err?.message || 'Could not build the observation')
  }
})
