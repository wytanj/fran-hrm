// One person's place in the org: their seat, titles, manager, direct reports,
// upward chain, and what they are accountable for. This is the endpoint a
// future 1:1 scheduler or meeting-agenda builder reads.
import {
  accountabilitiesForStaff, listPositions, listStaffOrg,
  resolveAllReports, resolveDirectReports, resolveManager, resolveReportingChain,
} from '../../../../core/org/query.mjs'
import { resolveStaff } from '../../../../core/staff/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'org:read' })
  const db = getAdminClient()
  const q = getQuery(event)

  const ref = q.staff_id ? String(q.staff_id) : (ctx.kind === 'session' ? ctx.staff.id : null)
  if (!ref) throw apiError(400, 'staff_id is required for API-key callers')

  const target = await resolveStaff(db, ctx.workspaceId, ref)
  if (ctx.kind === 'session' && !hasTeamReach(ctx) && target.id !== ctx.staff.id) {
    throw apiError(403, 'You can only view your own reporting line')
  }

  const [positions, staff] = await Promise.all([
    listPositions(db, ctx.workspaceId, { include_inactive: true }),
    listStaffOrg(db, ctx.workspaceId, {}),
  ])
  const me = staff.find((s: any) => s.id === target.id) || null
  if (!me) throw apiError(404, 'Staff member is not active')

  const seat = positions.find((p: any) => p.id === me.position_id) || null
  const managerInfo = resolveManager(me, staff, positions)

  return {
    data: {
      staff: me,
      seat,
      manager: managerInfo.manager,
      manager_source: managerInfo.source,
      manager_warning: managerInfo.source === 'vacant_seat'
        ? `Reports into a vacant seat${managerInfo.vacant_position ? ` (${managerInfo.vacant_position.display_title})` : ''} — set an interim manager on the staff record.`
        : managerInfo.source === 'position_ambiguous'
          ? 'The manager seat has several holders; set reports_to on the staff record to disambiguate.'
          : null,
      direct_reports: resolveDirectReports(me, staff, positions),
      all_reports: resolveAllReports(me, staff, positions),
      reporting_chain: resolveReportingChain(me, staff, positions),
      accountabilities: await accountabilitiesForStaff(db, ctx.workspaceId, me),
    },
  }
})
