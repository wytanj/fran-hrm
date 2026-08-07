// Leave queries shared by REST + MCP.

export async function listLeaveTypes(db, workspaceId) {
  const { data, error } = await db
    .from('leave_types')
    .select('id, code, name, is_paid, default_days_per_year, requires_attachment, is_active')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('code')
  if (error) throw new Error(error.message)
  return data || []
}

export async function listLeaveRequests(db, workspaceId, { staff_id, status, from, to, limit = 100 }) {
  let q = db
    .from('leave_requests')
    .select('id, staff_id, leave_type_id, start_date, end_date, days, half_day, reason, status, decided_by, decided_at, decision_note, created_at, staff:staff_id(employee_code, display_name), leave_type:leave_type_id(code, name)', { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })
    .limit(Math.min(Number(limit) || 100, 500))
  if (staff_id) q = q.eq('staff_id', staff_id)
  if (status) q = q.eq('status', status)
  if (from) q = q.gte('end_date', from)
  if (to) q = q.lte('start_date', to)
  const { data, count, error } = await q
  if (error) throw new Error(error.message)
  return { data: data || [], total: count || 0 }
}

export async function getLeaveBalances(db, workspaceId, { staff_id, year }) {
  if (!staff_id) throw new Error('staff_id is required')
  const y = Number(year) || new Date().getFullYear()
  const { data, error } = await db
    .from('leave_balances')
    .select('id, leave_type_id, year, entitled_days, used_days, leave_type:leave_type_id(code, name, is_paid)')
    .eq('workspace_id', workspaceId)
    .eq('staff_id', staff_id)
    .eq('year', y)
  if (error) throw new Error(error.message)
  return (data || []).map((b) => ({
    leave_type: b.leave_type?.code,
    leave_type_name: b.leave_type?.name,
    year: b.year,
    entitled_days: Number(b.entitled_days),
    used_days: Number(b.used_days),
    remaining_days: Number(b.entitled_days) - Number(b.used_days),
  }))
}

/** Inclusive day count between two YYYY-MM-DD dates. */
export function leaveDaysBetween(startDate, endDate, halfDay = false) {
  const days = Math.round((new Date(`${endDate}T00:00:00Z`) - new Date(`${startDate}T00:00:00Z`)) / 86400000) + 1
  if (days < 1) throw new Error('end_date must be on or after start_date')
  return halfDay && days === 1 ? 0.5 : days
}
