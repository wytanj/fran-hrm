// Roster/shift queries shared by REST + MCP.
// Doctrine: staff-facing reads default to the PUBLISHED roster; drafts are
// only returned when explicitly asked for by a manager surface.

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
