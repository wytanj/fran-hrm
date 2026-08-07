// Worked-hours computation — the single source of truth used by both the
// REST API (/api/v1/reports/hours) and the MCP tool (hours_worked), so an
// agent asking "how many hours did Farah work last month" gets exactly the
// number payroll sees.
//
// Inputs are time_entries rows (one per staff per day). Net minutes =
// (clock_out - clock_in) - break_minutes. Weeks run Monday–Sunday; weekly OT
// is hours past the configurable threshold (MOM default: 44h/week). Daily OT
// past ot_daily_threshold_hours is reported per day. OT is flagged for
// review, never auto-paid.

/** Monday of the ISO week containing dateStr (YYYY-MM-DD). */
export function weekStartOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7 // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

function round2(n) {
  return Math.round(n * 100) / 100
}

export function entryNetMinutes(entry) {
  if (!entry.clock_in_at || !entry.clock_out_at) return 0
  const gross = (new Date(entry.clock_out_at) - new Date(entry.clock_in_at)) / 60000
  return Math.max(0, gross - (entry.break_minutes || 0))
}

/**
 * @param {Array<object>} entries time_entries rows for ONE staff member
 * @param {object} [settings] workspace settings (ot thresholds)
 * @returns {{
 *   total_hours: number, break_hours: number, days_worked: number,
 *   incomplete_entries: number, by_date: object[], by_week: object[],
 *   overtime: { weekly_threshold_hours: number, daily_threshold_hours: number,
 *               weekly_ot_hours: number, daily_ot_hours: number }
 * }}
 */
export function computeHours(entries, settings = {}) {
  const weeklyThreshold = Number(settings.ot_weekly_threshold_hours) || 44
  const dailyThreshold = Number(settings.ot_daily_threshold_hours) || 12

  const byDate = new Map()
  let breakMinutes = 0
  let incomplete = 0

  for (const e of entries) {
    if (!e.clock_in_at || !e.clock_out_at) {
      incomplete += 1
      continue
    }
    const net = entryNetMinutes(e)
    breakMinutes += e.break_minutes || 0
    const day = byDate.get(e.work_date) || { work_date: e.work_date, minutes: 0, entries: 0 }
    day.minutes += net
    day.entries += 1
    byDate.set(e.work_date, day)
  }

  const days = [...byDate.values()].sort((a, b) => (a.work_date < b.work_date ? -1 : 1))
  const byWeek = new Map()
  let dailyOtMinutes = 0

  for (const day of days) {
    const ws = weekStartOf(day.work_date)
    const week = byWeek.get(ws) || { week_start: ws, minutes: 0, days: 0 }
    week.minutes += day.minutes
    week.days += 1
    byWeek.set(ws, week)
    day.hours = round2(day.minutes / 60)
    day.daily_ot_hours = round2(Math.max(0, day.minutes / 60 - dailyThreshold))
    dailyOtMinutes += Math.max(0, day.minutes - dailyThreshold * 60)
    delete day.minutes
  }

  let weeklyOtMinutes = 0
  const weeks = [...byWeek.values()].map((w) => {
    const ot = Math.max(0, w.minutes - weeklyThreshold * 60)
    weeklyOtMinutes += ot
    return {
      week_start: w.week_start,
      days_worked: w.days,
      hours: round2(w.minutes / 60),
      weekly_ot_hours: round2(ot / 60),
    }
  })

  const totalMinutes = days.reduce((sum, d) => sum + d.hours * 60, 0)

  return {
    total_hours: round2(totalMinutes / 60),
    break_hours: round2(breakMinutes / 60),
    days_worked: days.length,
    incomplete_entries: incomplete,
    by_date: days,
    by_week: weeks,
    overtime: {
      weekly_threshold_hours: weeklyThreshold,
      daily_threshold_hours: dailyThreshold,
      weekly_ot_hours: round2(weeklyOtMinutes / 60),
      daily_ot_hours: round2(dailyOtMinutes / 60),
    },
  }
}
