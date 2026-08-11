// Time & attendance queries shared by REST + MCP.
import { computeHours } from '../hours/compute.mjs'

const ENTRY_COLS = 'id, store_id, staff_id, shift_id, work_date, clock_in_at, clock_out_at, break_minutes, break_open_at, job_code, source, status'

export async function listTimeEntries(db, workspaceId, { staff_id, store_id, from, to, limit = 200 }) {
  let q = db
    .from('time_entries')
    .select(`${ENTRY_COLS}, staff:staff_id(employee_code, display_name, is_dummy)`, { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .order('work_date', { ascending: false })
    .order('clock_in_at', { ascending: false })
    .limit(Math.min(Number(limit) || 200, 500))
  if (staff_id) q = q.eq('staff_id', staff_id)
  if (store_id) q = q.eq('store_id', store_id)
  if (from) q = q.gte('work_date', from)
  if (to) q = q.lte('work_date', to)
  const { data, count, error } = await q
  if (error) throw new Error(error.message)
  return { data: data || [], total: count || 0 }
}

/**
 * The flagship computation: worked hours for one staff member in a window.
 * Pulls that staff's time entries and runs computeHours — same output for
 * the REST report, the UI, and the MCP hours_worked tool.
 */
export async function hoursWorked(db, workspaceId, { staff_id, from, to }, settings = {}) {
  if (!staff_id || !from || !to) throw new Error('staff_id, from and to are required')
  const { data, error } = await db
    .from('time_entries')
    .select(ENTRY_COLS)
    .eq('workspace_id', workspaceId)
    .eq('staff_id', staff_id)
    .gte('work_date', from)
    .lte('work_date', to)
    .order('work_date')
  if (error) throw new Error(error.message)
  const result = computeHours(data || [], settings)
  return { staff_id, from, to, ...result }
}

export async function listFlags(db, workspaceId, { staff_id, store_id, from, to, flag_type, status, limit = 200 }) {
  let q = db
    .from('attendance_flags')
    .select('id, staff_id, store_id, shift_id, time_entry_id, work_date, flag_type, details, status, created_at, staff:staff_id(employee_code, display_name)', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .order('work_date', { ascending: false })
    .limit(Math.min(Number(limit) || 200, 500))
  if (staff_id) q = q.eq('staff_id', staff_id)
  if (store_id) q = q.eq('store_id', store_id)
  if (from) q = q.gte('work_date', from)
  if (to) q = q.lte('work_date', to)
  if (flag_type) q = q.eq('flag_type', flag_type)
  if (status) q = q.eq('status', status)
  const { data, count, error } = await q
  if (error) throw new Error(error.message)
  return { data: data || [], total: count || 0 }
}

/**
 * Store-level attendance summary for a window: per-staff worked hours, OT,
 * lateness/no-show counts. Powers the MCP attendance_summary tool and the
 * reports UI without dumping raw entries into agent context.
 */
export async function attendanceSummary(db, workspaceId, { store_id, from, to, includeDummy = false }, settings = {}) {
  if (!from || !to) throw new Error('from and to are required')
  let q = db
    .from('time_entries')
    .select(`${ENTRY_COLS}, staff:staff_id(id, employee_code, display_name, employment_type, is_dummy)`)
    .eq('workspace_id', workspaceId)
    .gte('work_date', from)
    .lte('work_date', to)
  if (store_id) q = q.eq('store_id', store_id)
  const { data: entries, error } = await q
  if (error) throw new Error(error.message)

  let fq = db
    .from('attendance_flags')
    .select('staff_id, flag_type')
    .eq('workspace_id', workspaceId)
    .gte('work_date', from)
    .lte('work_date', to)
  if (store_id) fq = fq.eq('store_id', store_id)
  const { data: flags, error: ferr } = await fq
  if (ferr) throw new Error(ferr.message)

  const byStaff = new Map()
  for (const e of entries || []) {
    const key = e.staff_id
    const bucket = byStaff.get(key) || { staff: e.staff, entries: [] }
    bucket.entries.push(e)
    byStaff.set(key, bucket)
  }
  const flagCounts = new Map()
  for (const f of flags || []) {
    const counts = flagCounts.get(f.staff_id) || {}
    counts[f.flag_type] = (counts[f.flag_type] || 0) + 1
    flagCounts.set(f.staff_id, counts)
  }

  const rows = [...byStaff.values()].map(({ staff, entries: staffEntries }) => {
    const hours = computeHours(staffEntries, settings)
    return {
      staff_id: staff?.id,
      employee_code: staff?.employee_code,
      display_name: staff?.display_name,
      employment_type: staff?.employment_type,
      is_dummy: staff?.is_dummy || false,
      total_hours: hours.total_hours,
      days_worked: hours.days_worked,
      weekly_ot_hours: hours.overtime.weekly_ot_hours,
      incomplete_entries: hours.incomplete_entries,
      flags: flagCounts.get(staff?.id) || {},
    }
  }).sort((a, b) => (a.employee_code || '').localeCompare(b.employee_code || ''))

  // Simulated (dummy) staff are excluded from real hours/cost unless asked for.
  const visible = includeDummy ? rows : rows.filter((r) => !r.is_dummy)
  return {
    store_id: store_id || null, from, to,
    staff_count: visible.length, rows: visible,
    simulated_excluded: includeDummy ? 0 : rows.length - visible.length,
  }
}
