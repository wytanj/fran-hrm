// Roster/shift queries shared by REST + MCP.
// Doctrine: staff-facing reads default to the PUBLISHED roster; drafts are
// only returned when explicitly asked for by a manager surface.

import { recordAudit } from '../audit/record.mjs'
import { createNotification } from '../notifications/record.mjs'
import { availabilityLockNotification } from './lockCopy.mjs'
import { availabilityWindowFor, isDateLockedByRules } from '../scheduling/rules.mjs'

const SHIFT_COLS = 'id, roster_id, store_id, staff_id, work_date, start_at, end_at, break_minutes, job_code, template_id, status, notes'

export function compactShift(row) {
  return {
    id: row.id,
    store_id: row.store_id,
    staff_id: row.staff_id,
    staff: row.staff ? { id: row.staff.id, employee_code: row.staff.employee_code, display_name: row.staff.display_name } : undefined,
    work_date: row.work_date,
    start_at: row.start_at,
    end_at: row.end_at,
    break_minutes: row.break_minutes,
    job_code: row.job_code,
    status: row.status,
    notes: row.notes || undefined,
  }
}

export async function getRoster(db, workspaceId, { store_id, week_start, include_draft = false }) {
  if (!store_id || !week_start) throw new Error('store_id and week_start are required')
  let q = db
    .from('rosters')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('store_id', store_id)
    .eq('week_start', week_start)
  if (!include_draft) q = q.eq('status', 'published')
  const { data, error } = await q.maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  const shifts = await db
    .from('shifts')
    .select(`${SHIFT_COLS}, staff:staff_id(id, employee_code, display_name)`)
    .eq('roster_id', data.id)
    .neq('status', 'cancelled')
    .order('work_date')
    .order('start_at')
  if (shifts.error) throw new Error(shifts.error.message)
  return { ...data, shifts: (shifts.data || []).map(compactShift) }
}

export async function listShifts(db, workspaceId, { staff_id, store_id, from, to, published_only = true, limit = 200 }) {
  let q = db
    .from('shifts')
    .select(`${SHIFT_COLS}, staff:staff_id(id, employee_code, display_name, is_dummy), roster:roster_id(status, week_start)`)
    .eq('workspace_id', workspaceId)
    .neq('status', 'cancelled')
    .order('work_date')
    .order('start_at')
    .limit(Math.min(Number(limit) || 200, 500))
  if (staff_id) q = q.eq('staff_id', staff_id)
  if (store_id) q = q.eq('store_id', store_id)
  if (from) q = q.gte('work_date', from)
  if (to) q = q.lte('work_date', to)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  let rows = data || []
  if (published_only) rows = rows.filter((r) => r.roster?.status === 'published')
  return rows.map((r) => ({ ...compactShift(r), roster_status: r.roster?.status }))
}

export async function listAvailability(db, workspaceId, { staff_id, from, to }) {
  let q = db
    .from('availability')
    .select('id, staff_id, work_date, kind, start_time, end_time, note, submitted_at, staff:staff_id(employee_code, display_name)')
    .eq('workspace_id', workspaceId)
    .order('work_date')
    .limit(500)
  if (staff_id) q = q.eq('staff_id', staff_id)
  if (from) q = q.gte('work_date', from)
  if (to) q = q.lte('work_date', to)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

/** Manager-set locks on (staff_id, work_date). Independent of the cutoff. */
export async function listAvailabilityLocks(db, workspaceId, { staff_id, from, to } = {}) {
  let q = db
    .from('availability_locks')
    .select('staff_id, work_date, locked_at, locked_by:locked_by(employee_code, display_name)')
    .eq('workspace_id', workspaceId)
    .order('work_date')
    .limit(500)
  if (staff_id) q = q.eq('staff_id', staff_id)
  if (from) q = q.gte('work_date', from)
  if (to) q = q.lte('work_date', to)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

/**
 * Lock or unlock a staff member's availability for specific dates —
 * independent of the automatic edit cutoff. Self-audits (LOCK/UNLOCK), so
 * both the REST route and the MCP tool call this instead of writing
 * availability_locks directly.
 *
 * @param {{ staffId: string, dates: string[], locked: boolean, lockedBy?: string|null }} input
 * @param {object} actor { workspace_id, actor_kind, actor_id, actor_name, source_type }
 */
export async function setAvailabilityLocks(db, workspaceId, { staffId, dates, locked, lockedBy = null }, actor = {}) {
  if (!staffId) throw new Error('staff_id is required')
  const uniqueDates = [...new Set(dates || [])]
  if (!uniqueDates.length) throw new Error('dates[] is required')

  const { data: target } = await db.from('staff').select('id')
    .eq('workspace_id', workspaceId).eq('id', staffId).maybeSingle()
  if (!target) throw new Error('Staff not found in this workspace')

  if (locked) {
    const lockedAt = new Date().toISOString()
    const rows = uniqueDates.map((workDate) => ({
      workspace_id: workspaceId, staff_id: staffId, work_date: workDate,
      locked_by: lockedBy, locked_at: lockedAt,
    }))
    const { error } = await db.from('availability_locks').upsert(rows, { onConflict: 'staff_id,work_date' })
    if (error) throw new Error(error.message)
  } else {
    const { error } = await db.from('availability_locks').delete()
      .eq('workspace_id', workspaceId).eq('staff_id', staffId).in('work_date', uniqueDates)
    if (error) throw new Error(error.message)
  }

  await recordAudit(db, {
    workspace_id: workspaceId,
    actor_kind: actor.actor_kind || 'user',
    actor_id: actor.actor_id || null,
    actor_name: actor.actor_name || null,
    source_type: actor.source_type || 'web',
    object_type: 'availability_lock',
    entity_id: staffId,
    operation: locked ? 'LOCK' : 'UNLOCK',
    after_data: { dates: uniqueDates },
  })

  // One notification per call, not per date — a week-lock is a single message.
  // createNotification never throws, so a notify failure cannot undo the lock.
  const copy = availabilityLockNotification({
    locked,
    dates: uniqueDates,
    actorName: actor.actor_name,
  })
  await createNotification(db, {
    workspace_id: workspaceId,
    staff_id: staffId,
    ...copy,
  })

  if (!locked) return []
  const from = uniqueDates.reduce((a, b) => (a < b ? a : b))
  const to = uniqueDates.reduce((a, b) => (a > b ? a : b))
  const wanted = new Set(uniqueDates)
  const locks = await listAvailabilityLocks(db, workspaceId, { staff_id: staffId, from, to })
  return locks.filter((r) => wanted.has(r.work_date))
}

/**
 * Guardrail checks run before publishing (and surfaced while drafting):
 * leave clashes, PT weekly-cap breaches, weekly OT projections, and FT staff
 * with no rest day. Returns warnings; publishing proceeds unless blocked by
 * the caller — warnings are for the SM to resolve, not hard stops.
 */
export async function rosterGuardrails(db, workspaceId, roster, shifts, settings = {}) {
  const warnings = []
  const weeklyThreshold = Number(settings.ot_weekly_threshold_hours) || 44
  const staffIds = [...new Set(shifts.map((s) => s.staff_id).filter(Boolean))]
  if (!staffIds.length) return warnings

  const weekEnd = new Date(`${roster.week_start}T00:00:00Z`)
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
  const weekEndStr = weekEnd.toISOString().slice(0, 10)

  const [{ data: staffRows }, { data: leaves }] = await Promise.all([
    db.from('staff').select('id, employee_code, display_name, employment_type, pt_weekly_hour_cap').in('id', staffIds),
    db.from('leave_requests').select('staff_id, start_date, end_date, status, leave_type:leave_type_id(code)')
      .eq('workspace_id', workspaceId)
      .in('staff_id', staffIds)
      .in('status', ['pending', 'approved'])
      .lte('start_date', weekEndStr)
      .gte('end_date', roster.week_start),
  ])
  const staffMap = new Map((staffRows || []).map((s) => [s.id, s]))

  const hoursByStaff = new Map()
  const datesByStaff = new Map()
  for (const sh of shifts) {
    if (!sh.staff_id) continue
    const net = ((new Date(sh.end_at) - new Date(sh.start_at)) / 3600000) - (sh.break_minutes || 0) / 60
    hoursByStaff.set(sh.staff_id, (hoursByStaff.get(sh.staff_id) || 0) + net)
    const set = datesByStaff.get(sh.staff_id) || new Set()
    set.add(sh.work_date)
    datesByStaff.set(sh.staff_id, set)

    for (const lv of leaves || []) {
      if (lv.staff_id === sh.staff_id && sh.work_date >= lv.start_date && sh.work_date <= lv.end_date) {
        const s = staffMap.get(sh.staff_id)
        warnings.push({
          type: 'leave_clash',
          staff: s?.display_name,
          work_date: sh.work_date,
          detail: `${s?.display_name} has ${lv.status} ${lv.leave_type?.code || 'leave'} covering ${sh.work_date}`,
        })
      }
    }
  }

  for (const [staffId, hours] of hoursByStaff) {
    const s = staffMap.get(staffId)
    if (!s) continue
    if (s.employment_type === 'part_time' && s.pt_weekly_hour_cap && hours > Number(s.pt_weekly_hour_cap)) {
      warnings.push({
        type: 'pt_cap_exceeded',
        staff: s.display_name,
        detail: `${s.display_name} scheduled ${hours.toFixed(1)}h > PT weekly cap ${s.pt_weekly_hour_cap}h`,
      })
    }
    if (hours > weeklyThreshold) {
      warnings.push({
        type: 'ot_projected',
        staff: s.display_name,
        detail: `${s.display_name} scheduled ${hours.toFixed(1)}h > ${weeklyThreshold}h weekly OT threshold`,
      })
    }
    if (s.employment_type === 'full_time' && (datesByStaff.get(staffId)?.size || 0) >= 7) {
      warnings.push({
        type: 'no_rest_day',
        staff: s.display_name,
        detail: `${s.display_name} is scheduled all 7 days — no rest day this week`,
      })
    }
  }
  return warnings
}

// ───────────────────────── availability submit ─────────────────────────

const AVAILABILITY_KINDS = ['available', 'preferred', 'unavailable']

function submitError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function isoDate(value) {
  const s = String(value || '').trim()
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

/**
 * Submit or amend availability for one person. Shared by the REST route
 * (web form), the Telegram bot and MCP so every guard lives in exactly one
 * place:
 *
 *   - availability_required=false → self-service refused (managers pass)
 *   - workspace cutoff (availability_cutoff_days, default 7) for self-service
 *   - the scheduling-rules window: a month whose lock day has passed is
 *     closed to self-service (core/scheduling/rules.mjs)
 *   - manager locks on specific dates (availability_locks)
 *
 * `isManager` means the caller holds roster:write — they plan for others,
 * so every guard above is theirs to override. Replaces the existing rows for
 * each submitted date, then audits.
 *
 * Throws Error with `.status` (400/403/422) so the route can map it.
 *
 * @param {{ staffId: string, entries: Array<{work_date, kind, start_time?, end_time?, note?}>,
 *           isManager?: boolean, cutoffDays?: number, rules?: object|null, today?: string }} input
 * @param {object} actor { actor_kind, actor_id, actor_name, source_type }
 */
export async function submitAvailability(db, workspaceId, input, actor = {}) {
  const { staffId, isManager = false, rules = null } = input
  const entries = Array.isArray(input.entries) ? input.entries : []
  const today = input.today || sgTodayDate()
  const cutoffDays = Number(input.cutoffDays) || 7
  const cutoffDate = addDaysIso(today, cutoffDays)
  if (!staffId) throw submitError(400, 'staff_id is required')
  if (!entries.length) throw submitError(400, 'entries[] is required')

  const { data: target, error: targetErr } = await db.from('staff')
    .select('id, availability_required, employment_status')
    .eq('workspace_id', workspaceId).eq('id', staffId).maybeSingle()
  if (targetErr) throw submitError(500, targetErr.message)
  if (!target) throw submitError(404, 'Staff not found in this workspace')

  // Self-service only: a person flagged as not needing availability cannot
  // submit. roster:write holders still can, same as the cutoff and manager
  // locks. Switching the flag off must not leave a back-door that would
  // then start constraining them in generate (stated && !ok).
  if (!isManager && target.availability_required === false) {
    throw submitError(403, 'Your role doesn\'t need day-by-day availability — ask your manager if this should change.')
  }

  const dates = []
  const rows = entries.map((e) => {
    const workDate = isoDate(e.work_date)
    if (!workDate) throw submitError(400, 'work_date must be YYYY-MM-DD')
    if (!isManager && workDate < cutoffDate) {
      throw submitError(422, `Availability for ${workDate} is past the cutoff (${cutoffDays} days ahead). Ask your manager to adjust the roster directly.`)
    }
    if (!isManager && rules && isDateLockedByRules(rules, workDate, today)) {
      const w = availabilityWindowFor(rules, workDate.slice(0, 7), today)
      throw submitError(422, `Availability for ${monthLabel(w.month)} closed on ${w.lock_date} (scheduling rules: lock day ${rules.availability.lock_day_of_prior_month} of the prior month). Ask your manager to change it for you.`)
    }
    if (!AVAILABILITY_KINDS.includes(e.kind)) {
      throw submitError(400, 'kind must be available | preferred | unavailable')
    }
    dates.push(workDate)
    return {
      workspace_id: workspaceId,
      staff_id: staffId,
      work_date: workDate,
      kind: e.kind,
      start_time: e.kind === 'unavailable' ? null : (e.start_time || null),
      end_time: e.kind === 'unavailable' ? null : (e.end_time || null),
      note: e.note || null,
    }
  })

  if (!isManager && dates.length) {
    const from = dates.reduce((a, b) => (a < b ? a : b))
    const to = dates.reduce((a, b) => (a > b ? a : b))
    const lockRows = await listAvailabilityLocks(db, workspaceId, { staff_id: staffId, from, to })
    const lockedDates = new Set(lockRows.map((r) => r.work_date))
    for (const workDate of dates) {
      if (lockedDates.has(workDate)) {
        throw submitError(422, `Availability for ${workDate} is locked while the roster is being built. Ask your manager to unlock it if you need to change it.`)
      }
    }
  }

  const uniqueDates = [...new Set(dates)]
  const { error: delErr } = await db.from('availability').delete()
    .eq('workspace_id', workspaceId).eq('staff_id', staffId).in('work_date', uniqueDates)
  if (delErr) throw submitError(400, delErr.message)
  const { data, error } = await db.from('availability').insert(rows).select()
  if (error) throw submitError(400, error.message)

  await recordAudit(db, {
    workspace_id: workspaceId,
    actor_kind: actor.actor_kind || 'user',
    actor_id: actor.actor_id || null,
    actor_name: actor.actor_name || null,
    source_type: actor.source_type || 'web',
    object_type: 'availability',
    entity_id: staffId,
    operation: 'UPDATE',
    after_data: { dates: uniqueDates, count: rows.length },
  })
  return { data: data || [], dates: uniqueDates }
}

function sgTodayDate() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

function addDaysIso(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export function monthLabel(month) {
  const m = String(month || '').match(/^(\d{4})-(\d{2})$/)
  if (!m) return String(month || '')
  return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`
}
