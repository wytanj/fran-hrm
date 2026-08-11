import { hoursWorked, attendanceSummary } from '../../../../core/attendance/query.mjs'
import { resolveStaff } from '../../../../core/staff/query.mjs'
import { assertDate, csvEscape } from '../../../utils/dates'

// Worked-hours report. ?staff_id (or employee code) + from + to → per-staff
// breakdown with OT; ?store_id + from + to → per-store summary. Manpower
// cost (rate × hours) is included only for AM+/reports:read callers.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'reports:read' })
  const q = getQuery(event)
  const db = getAdminClient()
  const from = assertDate(q.from, 'from')
  const to = assertDate(q.to, 'to')
  const settings = await getWorkspaceSettings(ctx.workspaceId)
  const canSeeCost = ctx.has('reports:cost')

  if (q.staff_id) {
    const requested = String(q.staff_id)
    const staff = await resolveStaff(db, ctx.workspaceId, requested)
    if (ctx.kind === 'session' && !hasTeamReach(ctx) && staff.id !== ctx.staff.id) {
      throw apiError(403, 'You can only view your own hours')
    }
    const result = await hoursWorked(db, ctx.workspaceId, { staff_id: staff.id, from, to }, settings)
    const out: any = {
      staff: { id: staff.id, employee_code: staff.employee_code, display_name: staff.display_name, employment_type: staff.employment_type },
      ...result,
    }
    if (canSeeCost && staff.hourly_rate_cents) {
      out.cost = {
        hourly_rate_cents: staff.hourly_rate_cents,
        estimated_cost_cents: Math.round(result.total_hours * staff.hourly_rate_cents),
      }
    }
    return { data: out }
  }

  // No staff_id means the whole store — that is a manager view.
  assertTeamReach(ctx, 'Store-wide hours summaries')
  const summary = await attendanceSummary(db, ctx.workspaceId, {
    store_id: q.store_id ? String(q.store_id) : undefined, from, to,
    includeDummy: q.include_dummy === 'true',
  }, settings)
  if (canSeeCost) {
    const ids = summary.rows.map((r: any) => r.staff_id).filter(Boolean)
    if (ids.length) {
      const { data: rates } = await db.from('staff').select('id, hourly_rate_cents').in('id', ids)
      const rateMap = new Map((rates || []).map((r: any) => [r.id, r.hourly_rate_cents]))
      let totalCost = 0
      for (const row of summary.rows as any[]) {
        const rate = rateMap.get(row.staff_id)
        if (rate) {
          row.estimated_cost_cents = Math.round(row.total_hours * rate)
          totalCost += row.estimated_cost_cents
        }
      }
      ;(summary as any).estimated_total_cost_cents = totalCost
    }
  }

  if (String(q.format) === 'csv') {
    const headers = ['employee_code', 'display_name', 'employment_type', 'total_hours', 'days_worked', 'weekly_ot_hours', 'incomplete_entries', ...(canSeeCost ? ['estimated_cost_cents'] : [])]
    const csv = [
      headers.join(','),
      ...(summary.rows as any[]).map((r) => headers.map((h) => csvEscape(r[h])).join(',')),
    ].join('\n')
    setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
    setHeader(event, 'Content-Disposition', `attachment; filename="hours_${from}_${to}.csv"`)
    return csv
  }
  return { data: summary }
})
