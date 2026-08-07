import { listShifts } from '../../../../core/roster/query.mjs'
import { listTimeEntries } from '../../../../core/attendance/query.mjs'
import { assertDate, csvEscape } from '../../../utils/dates'

// Attendance export: scheduled vs actual per staff per day, with lateness
// and variance columns. ?format=csv downloads Excel-ready CSV; default JSON.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'reports:read' })
  // A store-wide scheduled-vs-actual export, not a personal payslip.
  assertTeamReach(ctx, 'The attendance export')
  const q = getQuery(event)
  const db = getAdminClient()
  const from = assertDate(q.from, 'from')
  const to = assertDate(q.to, 'to')
  const storeId = q.store_id ? String(q.store_id) : undefined

  const [shifts, entries] = await Promise.all([
    listShifts(db, ctx.workspaceId, { store_id: storeId, from, to, published_only: true, limit: 500 }),
    listTimeEntries(db, ctx.workspaceId, { store_id: storeId, from, to, limit: 500 }),
  ])

  const entryKey = (staffId: string, date: string) => `${staffId}|${date}`
  const entryMap = new Map<string, any[]>()
  for (const e of entries.data) {
    const k = entryKey(e.staff_id, e.work_date)
    entryMap.set(k, [...(entryMap.get(k) || []), e])
  }

  const rows: any[] = []
  const seen = new Set<string>()
  for (const sh of shifts) {
    if (!sh.staff_id) continue
    const k = entryKey(sh.staff_id, sh.work_date)
    seen.add(k)
    const dayEntries = entryMap.get(k) || []
    const first = dayEntries[0]
    const lateMin = first?.clock_in_at ? Math.max(0, Math.round((new Date(first.clock_in_at).getTime() - new Date(sh.start_at).getTime()) / 60000)) : null
    rows.push({
      work_date: sh.work_date,
      employee_code: sh.staff?.employee_code || first?.staff?.employee_code,
      display_name: sh.staff?.display_name || first?.staff?.display_name,
      scheduled_start: sh.start_at,
      scheduled_end: sh.end_at,
      actual_in: first?.clock_in_at || null,
      actual_out: first?.clock_out_at || null,
      break_minutes: first?.break_minutes ?? null,
      status: !first ? 'no_show' : !first.clock_out_at ? 'missing_clock_out' : lateMin && lateMin > 5 ? 'late' : 'ok',
      minutes_late: lateMin,
    })
  }
  // Worked but unscheduled
  for (const [k, dayEntries] of entryMap) {
    if (seen.has(k)) continue
    for (const e of dayEntries) {
      rows.push({
        work_date: e.work_date,
        employee_code: e.staff?.employee_code,
        display_name: e.staff?.display_name,
        scheduled_start: null,
        scheduled_end: null,
        actual_in: e.clock_in_at,
        actual_out: e.clock_out_at,
        break_minutes: e.break_minutes,
        status: 'unscheduled',
        minutes_late: null,
      })
    }
  }
  rows.sort((a, b) => a.work_date.localeCompare(b.work_date) || String(a.employee_code).localeCompare(String(b.employee_code)))

  if (q.format === 'csv') {
    const headers = ['work_date', 'employee_code', 'display_name', 'scheduled_start', 'scheduled_end', 'actual_in', 'actual_out', 'break_minutes', 'status', 'minutes_late']
    const csv = [headers.join(','), ...rows.map((r) => headers.map((h) => csvEscape(r[h])).join(','))].join('\n')
    setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
    setHeader(event, 'Content-Disposition', `attachment; filename="attendance_${from}_${to}.csv"`)
    return csv
  }
  return { data: rows, from, to, total: rows.length }
})
