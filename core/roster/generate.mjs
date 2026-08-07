// Roster generation from a constraint set.
//
// Division of labour with the AI: the agent is good at turning "cover the
// weekend properly, Farah can't do Mondays, keep Erin under 44 hours" into a
// constraint object. It is bad at arithmetic over 40 slots without drifting.
// So the agent owns the constraints; this deterministic assigner owns the
// filling, the counting and the honesty about what it could not do.
//
// That split is also why unmet demand is a first-class output rather than an
// error: a week that needs three closers and has two available people should
// produce a roster with a named gap, not a failure.
import { WEEKDAYS, minutesOf } from './constraints.mjs'

const DAY_MS = 86400_000

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const sgIso = (date, time) => `${date}T${time}:00+08:00`

/**
 * @param {object} input
 * @param {object} input.constraints validated constraint set
 * @param {string} input.weekStart Monday, YYYY-MM-DD
 * @param {Array} input.staff candidates: { id, employee_code, display_name, employment_type, pt_weekly_hour_cap }
 * @param {Array} input.availability [{ staff_id, work_date, kind, start_time, end_time }]
 * @param {Array} input.leave [{ staff_id, start_date, end_date, status }]
 * @param {Array} [input.priorShifts] shifts in the days before weekStart, for rest/consecutive checks
 * @returns {{ shifts: Array, unmet: Array, warnings: Array, summary: object }}
 */
export function generateRoster({ constraints, weekStart, staff, availability = [], leave = [], priorShifts = [] }) {
  const rules = constraints.rules || {}
  const prefs = constraints.preferences || {}
  const narrowing = constraints.staff || {}

  // ── candidate pool ──
  let pool = staff.filter((s) => s.employment_status !== 'terminated' && s.employment_status !== 'inactive')
  if (narrowing.include?.length) pool = pool.filter((s) => narrowing.include.includes(s.employee_code))
  if (narrowing.exclude?.length) pool = pool.filter((s) => !narrowing.exclude.includes(s.employee_code))

  const warnings = []
  if (!pool.length) {
    return {
      shifts: [], unmet: [], warnings: ['No candidate staff after applying include/exclude — nothing could be scheduled.'],
      summary: { slots: 0, filled: 0, unfilled: 0 },
    }
  }

  // ── indexes ──
  const leaveByStaff = new Map()
  for (const l of leave) {
    if (!['approved', 'pending'].includes(l.status)) continue
    const list = leaveByStaff.get(l.staff_id) || []
    list.push(l)
    leaveByStaff.set(l.staff_id, list)
  }

  const availByKey = new Map() // `${staff_id}|${date}` → rows
  for (const a of availability) {
    const k = `${a.staff_id}|${a.work_date}`
    availByKey.set(k, [...(availByKey.get(k) || []), a])
  }

  // Running state per staff member across the week.
  const state = new Map(pool.map((s) => [s.id, {
    staff: s,
    minutes: 0,
    dates: new Set(),
    shifts: [],
    weekendCount: 0,
  }]))

  // Seed consecutive-day and rest checks from the week before.
  const priorByStaff = new Map()
  for (const p of priorShifts) {
    priorByStaff.set(p.staff_id, [...(priorByStaff.get(p.staff_id) || []), p])
  }

  const onLeave = (staffId, date) =>
    (leaveByStaff.get(staffId) || []).some((l) => date >= l.start_date && date <= l.end_date)

  /** null = no statement made; otherwise the availability verdict for a block. */
  function availabilityVerdict(staffId, date, start, end) {
    const rows = availByKey.get(`${staffId}|${date}`)
    if (!rows?.length) return { stated: false, ok: true, preferred: false }
    // Any 'unavailable' row covering the block is a no.
    for (const r of rows) {
      if (r.kind !== 'unavailable') continue
      if (!r.start_time || !r.end_time) return { stated: true, ok: false, preferred: false }
      if (overlaps(start, end, r.start_time.slice(0, 5), r.end_time.slice(0, 5))) {
        return { stated: true, ok: false, preferred: false }
      }
    }
    const windows = rows.filter((r) => r.kind === 'available' || r.kind === 'preferred')
    if (!windows.length) return { stated: true, ok: false, preferred: false }
    const fits = windows.find((r) => {
      if (!r.start_time || !r.end_time) return true
      return minutesOf(r.start_time.slice(0, 5)) <= minutesOf(start)
        && minutesOf(r.end_time.slice(0, 5)) >= minutesOf(end)
    })
    if (!fits) return { stated: true, ok: false, preferred: false }
    return { stated: true, ok: true, preferred: fits.kind === 'preferred' }
  }

  function consecutiveDaysEndingBefore(st, date) {
    const all = [...st.dates, ...(priorByStaff.get(st.staff.id) || []).map((p) => p.work_date)]
    let run = 0
    let cursor = addDays(date, -1)
    while (all.includes(cursor) && run < 20) { run += 1; cursor = addDays(cursor, -1) }
    return run
  }

  function restOkay(st, date, start) {
    const minRest = Number(rules.min_rest_hours_between_shifts) || 0
    if (!minRest) return true
    const startTs = new Date(sgIso(date, start)).getTime()
    const previous = [...st.shifts, ...(priorByStaff.get(st.staff.id) || [])]
    for (const s of previous) {
      const end = new Date(s.end_at).getTime()
      if (end <= startTs && startTs - end < minRest * 3600_000) return false
    }
    return true
  }

  const shifts = []
  const unmet = []

  // ── must_work seeding: honour explicit "X works Monday" before general fill ──
  const mustWork = new Map()
  for (const [code, days] of Object.entries(narrowing.must_work || {})) {
    const person = pool.find((s) => s.employee_code === code)
    if (!person) { warnings.push(`staff.must_work names ${code}, who is not in the candidate pool — ignored.`); continue }
    mustWork.set(person.id, new Set(days))
  }

  for (let dayIndex = 0; dayIndex < WEEKDAYS.length; dayIndex++) {
    const weekday = WEEKDAYS[dayIndex]
    const date = addDays(weekStart, dayIndex)
    const isWeekend = weekday === 'sat' || weekday === 'sun'
    const dayCoverage = (constraints.coverage || []).find((c) => c.weekday === weekday)
    if (!dayCoverage) continue

    for (const block of dayCoverage.blocks) {
      const netMinutes = minutesOf(block.end) - minutesOf(block.start) - (block.break_minutes || 0)

      for (let n = 0; n < block.count; n++) {
        const rejected = []
        const candidates = []

        for (const st of state.values()) {
          const s = st.staff
          const why = (reason) => rejected.push(`${s.employee_code}: ${reason}`)

          if (block.employment_type && s.employment_type !== block.employment_type) { why(`not ${block.employment_type}`); continue }
          if (block.only_staff?.length && !block.only_staff.includes(s.employee_code)) { why('not in only_staff'); continue }
          if (st.dates.has(date)) { why('already working this day'); continue }
          if (rules.respect_leave !== false && onLeave(s.id, date)) { why('on leave'); continue }

          const maxShifts = narrowing.max_shifts?.[s.employee_code]
          if (maxShifts != null && st.shifts.length >= maxShifts) { why(`hit max_shifts (${maxShifts})`); continue }

          const av = availabilityVerdict(s.id, date, block.start, block.end)
          if (rules.respect_availability !== false && av.stated && !av.ok) { why('unavailable'); continue }

          const projectedHours = (st.minutes + netMinutes) / 60
          if (rules.respect_pt_caps !== false && s.employment_type === 'part_time' && s.pt_weekly_hour_cap) {
            if (projectedHours > Number(s.pt_weekly_hour_cap)) { why(`would exceed PT cap ${s.pt_weekly_hour_cap}h`); continue }
          }
          if (rules.max_hours_per_day && netMinutes / 60 > Number(rules.max_hours_per_day)) {
            why('block longer than max_hours_per_day'); continue
          }
          const maxDays = 7 - (Number(rules.off_days_per_week) || 0)
          if (st.dates.size >= maxDays) { why(`already has ${st.dates.size} days (off_days_per_week=${rules.off_days_per_week})`); continue }
          if (consecutiveDaysEndingBefore(st, date) >= (Number(rules.max_consecutive_days) || 99)) {
            why(`would breach max_consecutive_days (${rules.max_consecutive_days})`); continue
          }
          if (!restOkay(st, date, block.start)) { why(`less than ${rules.min_rest_hours_between_shifts}h rest since last shift`); continue }

          // Scoring: lower is better. Fairness first, then preference, then OT.
          let score = 0
          if (prefs.balance_hours !== false) score += st.minutes / 60
          if (prefs.prefer_preferred_availability !== false && av.preferred) score -= 6
          if (av.stated && av.ok && !av.preferred) score -= 2
          if (prefs.fair_weekend_rotation !== false && isWeekend) score += st.weekendCount * 4
          if (projectedHours > (Number(rules.weekly_ot_threshold_hours) || 44)) score += 25
          if (mustWork.get(s.id)?.has(weekday)) score -= 50
          if (block.job_code && s.employment_type === 'part_time') score -= 1

          for (const [a, b] of prefs.avoid_pairs || []) {
            const other = [a, b].find((c) => c !== s.employee_code)
            if (![a, b].includes(s.employee_code) || !other) continue
            const otherWorkingBlock = shifts.some((sh) => sh.work_date === date && sh.employee_code === other && sh.start === block.start)
            if (otherWorkingBlock) score += 15
          }
          for (const [a, b] of prefs.keep_pairs || []) {
            const other = [a, b].find((c) => c !== s.employee_code)
            if (![a, b].includes(s.employee_code) || !other) continue
            const otherWorkingBlock = shifts.some((sh) => sh.work_date === date && sh.employee_code === other && sh.start === block.start)
            if (otherWorkingBlock) score -= 8
          }

          candidates.push({ st, score, preferred: av.preferred, stated: av.stated })
        }

        if (!candidates.length) {
          unmet.push({
            work_date: date,
            weekday,
            block: block.template || `${block.start}-${block.end}`,
            start: block.start,
            end: block.end,
            job_code: block.job_code,
            reason: 'No eligible staff for this slot',
            // The rejection list is the useful part: it tells a manager which
            // single constraint to relax.
            rejected: rejected.slice(0, 12),
          })
          continue
        }

        candidates.sort((a, b) => a.score - b.score)
        const chosen = candidates[0]
        const st = chosen.st

        st.minutes += netMinutes
        st.dates.add(date)
        if (isWeekend) st.weekendCount += 1

        const shift = {
          staff_id: st.staff.id,
          employee_code: st.staff.employee_code,
          display_name: st.staff.display_name,
          work_date: date,
          weekday,
          start: block.start,
          end: block.end,
          start_at: sgIso(date, block.start),
          end_at: sgIso(date, block.end),
          break_minutes: block.break_minutes || 0,
          job_code: block.job_code || null,
          template: block.template || null,
          hours: Math.round((netMinutes / 60) * 100) / 100,
          // Why this person: what an agent should quote when asked.
          reason: chosen.preferred
            ? 'stated this as a preferred shift'
            : chosen.stated
              ? 'available and had the fewest hours'
              : 'no availability stated; fewest hours so far',
        }
        st.shifts.push(shift)
        shifts.push(shift)
      }
    }
  }

  // ── post-checks that only make sense once the week is filled ──
  for (const st of state.values()) {
    const hours = st.minutes / 60
    const threshold = Number(rules.weekly_ot_threshold_hours) || 44
    if (hours > threshold) {
      warnings.push(`${st.staff.display_name} is scheduled ${hours.toFixed(1)}h — past the ${threshold}h OT threshold.`)
    }
    if (st.staff.employment_type === 'full_time' && st.dates.size === 7) {
      warnings.push(`${st.staff.display_name} has no rest day this week.`)
    }
    const cap = st.staff.pt_weekly_hour_cap
    if (st.staff.employment_type === 'part_time' && cap && hours > Number(cap)) {
      warnings.push(`${st.staff.display_name} is at ${hours.toFixed(1)}h against a ${cap}h PT cap.`)
    }
  }

  const perStaff = [...state.values()]
    .filter((st) => st.shifts.length)
    .map((st) => ({
      employee_code: st.staff.employee_code,
      display_name: st.staff.display_name,
      employment_type: st.staff.employment_type,
      shifts: st.shifts.length,
      days: st.dates.size,
      hours: Math.round((st.minutes / 60) * 10) / 10,
      weekend_shifts: st.weekendCount,
    }))
    .sort((a, b) => a.employee_code.localeCompare(b.employee_code))

  const slots = shifts.length + unmet.length
  return {
    shifts,
    unmet,
    warnings,
    summary: {
      week_start: weekStart,
      slots,
      filled: shifts.length,
      unfilled: unmet.length,
      total_hours: Math.round(shifts.reduce((s, sh) => s + sh.hours, 0) * 10) / 10,
      staff_used: perStaff.length,
      per_staff: perStaff,
    },
  }
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return minutesOf(aStart) < minutesOf(bEnd) && minutesOf(bStart) < minutesOf(aEnd)
}
