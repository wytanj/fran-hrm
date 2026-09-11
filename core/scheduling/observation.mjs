// The "truth panel" behind /scheduling-truth: for one roster month, who has
// to submit availability and whether they have, whether the window is
// locked (by the rules' lock day or by a manager), what approved leave sits
// in the month, and what the published roster says. Read-only; shared by
// REST (and MCP when a tool wants it).
//
// Nothing here guesses. A person is "submitted" only if they have at least
// one availability row inside the month; "missing" is the absence of that.
// Leave is reported, never turned into availability.

import { availabilityWindowFor, monthBounds, sgToday, addDays } from './rules.mjs'

function mondayOf(date) {
  const d = new Date(`${date}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

/**
 * @param {object} db
 * @param {string} workspaceId
 * @param {{ month: string, store_id?: string|null, rules: object, today?: string }} args
 */
export async function buildObservation(db, workspaceId, { month, store_id = null, rules, today = sgToday() }) {
  const window = availabilityWindowFor(rules, month, today)
  const { from, to } = monthBounds(month)

  // ── people ──
  let staffQ = db
    .from('staff')
    .select('id, employee_code, display_name, role, employment_type, employment_status, availability_required, is_dummy, home_store_id, home_store:home_store_id(id, code, name)')
    .eq('workspace_id', workspaceId)
    .eq('employment_status', 'active')
    .order('employee_code')
  if (store_id) staffQ = staffQ.eq('home_store_id', store_id)
  const { data: staffRows, error: staffErr } = await staffQ
  if (staffErr) throw new Error(staffErr.message)
  const staff = staffRows || []
  const staffIds = staff.map((s) => s.id)

  if (!staffIds.length) {
    return {
      month, window, store_id, today,
      stats: { people: 0, required: 0, submitted: 0, missing: 0, telegram_linked: 0, manager_locked: 0, on_leave: 0 },
      staff: [], rosters: [], leave: [],
    }
  }

  // ── availability, locks, leave, telegram links, rosters — in parallel ──
  const weekStarts = []
  for (let d = mondayOf(from); d <= to; d = addDays(d, 7)) weekStarts.push(d)

  let rosterQ = db
    .from('rosters')
    .select('id, store_id, week_start, status, version, published_at, store:store_id(id, code, name)')
    .eq('workspace_id', workspaceId)
    .in('week_start', weekStarts)
    .order('week_start')
  if (store_id) rosterQ = rosterQ.eq('store_id', store_id)

  const [availRes, lockRes, leaveRes, tgRes, rosterRes] = await Promise.all([
    db.from('availability').select('staff_id, work_date, kind')
      .eq('workspace_id', workspaceId).in('staff_id', staffIds).gte('work_date', from).lte('work_date', to).limit(5000),
    db.from('availability_locks').select('staff_id, work_date')
      .eq('workspace_id', workspaceId).in('staff_id', staffIds).gte('work_date', from).lte('work_date', to).limit(5000),
    db.from('leave_requests').select('id, staff_id, start_date, end_date, status, days, leave_type:leave_type_id(code, name)')
      .eq('workspace_id', workspaceId).in('staff_id', staffIds).in('status', ['approved', 'pending'])
      .lte('start_date', to).gte('end_date', from),
    db.from('staff_telegram_links').select('staff_id, telegram_username, linked_at')
      .eq('workspace_id', workspaceId).in('staff_id', staffIds),
    rosterQ,
  ])
  for (const r of [availRes, lockRes, leaveRes, rosterRes]) {
    if (r.error) throw new Error(r.error.message)
  }
  // Telegram table may not exist yet on a DB that has not run 032 — the panel
  // still has to render, so treat that as "nobody linked".
  const tgLinks = tgRes.error ? [] : (tgRes.data || [])

  const availByStaff = new Map()
  for (const a of availRes.data || []) {
    const rec = availByStaff.get(a.staff_id) || { days: new Set(), unavailable: 0, preferred: 0 }
    rec.days.add(a.work_date)
    if (a.kind === 'unavailable') rec.unavailable += 1
    if (a.kind === 'preferred') rec.preferred += 1
    availByStaff.set(a.staff_id, rec)
  }
  const locksByStaff = new Map()
  for (const l of lockRes.data || []) {
    locksByStaff.set(l.staff_id, (locksByStaff.get(l.staff_id) || 0) + 1)
  }
  const leaveByStaff = new Map()
  for (const lv of leaveRes.data || []) {
    const list = leaveByStaff.get(lv.staff_id) || []
    list.push({
      id: lv.id, start_date: lv.start_date, end_date: lv.end_date, status: lv.status,
      days: lv.days, type: lv.leave_type?.code || 'leave', type_name: lv.leave_type?.name || null,
    })
    leaveByStaff.set(lv.staff_id, list)
  }
  const tgByStaff = new Map(tgLinks.map((t) => [t.staff_id, t]))

  // ── shifts for the month's rosters ──
  const rosters = rosterRes.data || []
  let shiftRows = []
  if (rosters.length) {
    const { data, error } = await db
      .from('shifts')
      .select('roster_id, staff_id, work_date, start_at, end_at, break_minutes')
      .eq('workspace_id', workspaceId)
      .in('roster_id', rosters.map((r) => r.id))
      .neq('status', 'cancelled')
      .limit(10000)
    if (error) throw new Error(error.message)
    shiftRows = data || []
  }
  const shiftsByRoster = new Map()
  const shiftsByStaff = new Map()
  for (const sh of shiftRows) {
    const rec = shiftsByRoster.get(sh.roster_id) || { total: 0, open: 0, hours: 0 }
    rec.total += 1
    if (!sh.staff_id) rec.open += 1
    rec.hours += ((new Date(sh.end_at) - new Date(sh.start_at)) / 3600000) - (sh.break_minutes || 0) / 60
    shiftsByRoster.set(sh.roster_id, rec)
    if (sh.staff_id && sh.work_date >= from && sh.work_date <= to) {
      shiftsByStaff.set(sh.staff_id, (shiftsByStaff.get(sh.staff_id) || 0) + 1)
    }
  }
  const rosterById = new Map(rosters.map((r) => [r.id, r]))

  const staffOut = staff.map((s) => {
    const av = availByStaff.get(s.id)
    const required = s.availability_required !== false
    const submitted = Boolean(av && av.days.size)
    return {
      id: s.id,
      employee_code: s.employee_code,
      display_name: s.display_name,
      role: s.role,
      employment_type: s.employment_type,
      is_dummy: !!s.is_dummy,
      home_store: s.home_store ? { id: s.home_store.id, code: s.home_store.code, name: s.home_store.name } : null,
      availability_required: required,
      submitted,
      submitted_days: av ? av.days.size : 0,
      unavailable_days: av ? av.unavailable : 0,
      preferred_days: av ? av.preferred : 0,
      manager_locked_days: locksByStaff.get(s.id) || 0,
      window_locked: window.state === 'locked',
      telegram_linked: tgByStaff.has(s.id),
      telegram_username: tgByStaff.get(s.id)?.telegram_username || null,
      leave: leaveByStaff.get(s.id) || [],
      // Scheduled from published rosters only — drafts are not truth yet.
      published_shifts: [...shiftRows.filter((sh) => sh.staff_id === s.id && rosterById.get(sh.roster_id)?.status === 'published')].length,
      status: !required ? 'not_required' : submitted ? 'submitted' : window.state === 'locked' ? 'missing_locked' : 'missing',
    }
  })

  const required = staffOut.filter((s) => s.availability_required)
  const stats = {
    people: staffOut.length,
    required: required.length,
    submitted: required.filter((s) => s.submitted).length,
    missing: required.filter((s) => !s.submitted).length,
    telegram_linked: required.filter((s) => s.telegram_linked).length,
    manager_locked: staffOut.filter((s) => s.manager_locked_days > 0).length,
    on_leave: staffOut.filter((s) => s.leave.some((l) => l.status === 'approved')).length,
  }

  const rostersOut = weekStarts.map((weekStart) => {
    const rows = rosters.filter((r) => r.week_start === weekStart)
    if (!rows.length) {
      return { week_start: weekStart, week_end: addDays(weekStart, 6), status: 'none', rosters: [] }
    }
    return {
      week_start: weekStart,
      week_end: addDays(weekStart, 6),
      // Headline: published only if every store's roster for the week is published.
      status: rows.every((r) => r.status === 'published') ? 'published' : rows.some((r) => r.status === 'published') ? 'partial' : 'draft',
      rosters: rows.map((r) => {
        const sh = shiftsByRoster.get(r.id) || { total: 0, open: 0, hours: 0 }
        return {
          id: r.id,
          store: r.store ? { id: r.store.id, code: r.store.code, name: r.store.name } : null,
          status: r.status,
          version: r.version,
          published_at: r.published_at,
          shifts: sh.total,
          open_shifts: sh.open,
          hours: Math.round(sh.hours * 10) / 10,
        }
      }),
    }
  })

  const leaveOut = (leaveRes.data || []).map((lv) => {
    const s = staff.find((x) => x.id === lv.staff_id)
    return {
      id: lv.id, staff_id: lv.staff_id,
      employee_code: s?.employee_code, display_name: s?.display_name,
      start_date: lv.start_date, end_date: lv.end_date, status: lv.status, days: lv.days,
      type: lv.leave_type?.code || 'leave',
    }
  }).sort((a, b) => (a.start_date < b.start_date ? -1 : 1))

  return {
    month, window, store_id, today,
    publish: {
      target_date: window.publish_target_date,
      weeks_total: rostersOut.length,
      weeks_published: rostersOut.filter((w) => w.status === 'published').length,
      open_shifts: rostersOut.reduce((n, w) => n + w.rosters.reduce((m, r) => m + (r.status === 'published' ? r.open_shifts : 0), 0), 0),
    },
    stats,
    staff: staffOut,
    rosters: rostersOut,
    leave: leaveOut,
  }
}
