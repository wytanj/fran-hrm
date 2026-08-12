// Monthly pay proration. Payroll presumes a monthly salary, but no-pay leave
// and sabbaticals reduce it: prorate the monthly basic by the working days
// actually available. Working days here are Mon–Fri in the period (public
// holidays aren't netted out yet — a later refinement). Sabbaticals are just
// unpaid leave (an is_paid = false leave type), so they fall out of this too.
const DAY = 86_400_000

function* eachDate(from, to) {
  let t = new Date(`${from}T00:00:00Z`).getTime()
  const end = new Date(`${to}T00:00:00Z`).getTime()
  while (t <= end) {
    yield new Date(t).toISOString().slice(0, 10)
    t += DAY
  }
}
const isWeekday = (dateStr) => {
  const g = new Date(`${dateStr}T00:00:00Z`).getUTCDay()
  return g >= 1 && g <= 5
}
function workingDaysBetween(from, to) {
  let n = 0
  for (const d of eachDate(from, to)) if (isWeekday(d)) n += 1
  return n
}

/**
 * Prorate a monthly basic salary for approved unpaid leave in a period.
 * @returns {Promise<{working_days, no_pay_days, monthly_basic_cents,
 *   prorated_basic_cents, no_pay_deduction_cents, unpaid_leave: Array}>}
 */
export async function computeMonthlyProration(db, workspaceId, { staffId, periodStart, periodEnd, monthlyBasicCents }) {
  const monthly = Math.round(Number(monthlyBasicCents) || 0)
  const workingDays = workingDaysBetween(periodStart, periodEnd)

  const { data: leaves, error } = await db.from('leave_requests')
    .select('start_date, end_date, leave_type:leave_type_id(code, name, is_paid)')
    .eq('workspace_id', workspaceId).eq('staff_id', staffId).eq('status', 'approved')
    .lte('start_date', periodEnd).gte('end_date', periodStart)
  if (error) throw new Error(error.message)

  const noPay = new Set()
  const unpaid = []
  for (const l of leaves || []) {
    if (!l.leave_type || l.leave_type.is_paid) continue // paid leave doesn't cut pay
    const from = l.start_date > periodStart ? l.start_date : periodStart
    const to = l.end_date < periodEnd ? l.end_date : periodEnd
    let d = 0
    for (const date of eachDate(from, to)) if (isWeekday(date)) { noPay.add(date); d += 1 }
    unpaid.push({ type: l.leave_type.code, name: l.leave_type.name, from: l.start_date, to: l.end_date, working_days_in_period: d })
  }

  const noPayDays = noPay.size
  const prorated = workingDays > 0 ? Math.round((monthly * (workingDays - noPayDays)) / workingDays) : monthly
  return {
    working_days: workingDays,
    no_pay_days: noPayDays,
    monthly_basic_cents: monthly,
    prorated_basic_cents: prorated,
    no_pay_deduction_cents: monthly - prorated,
    unpaid_leave: unpaid,
  }
}
