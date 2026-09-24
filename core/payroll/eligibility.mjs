// Hire / term / payroll-eligibility window helpers for earnings + exporters.

function ymd(d) {
  return String(d || '').slice(0, 10)
}

function maxDate(a, b) {
  const aa = ymd(a), bb = ymd(b)
  if (!aa) return bb || null
  if (!bb) return aa || null
  return aa >= bb ? aa : bb
}

function minDate(a, b) {
  const aa = ymd(a), bb = ymd(b)
  if (!aa) return bb || null
  if (!bb) return aa || null
  return aa <= bb ? aa : bb
}

/** Resolve eligibility start: explicit payroll_eligible_from -> hire_gates -> hired_on. */
export function resolveEligibleFrom(staff, gates = null) {
  return ymd(staff?.payroll_eligible_from)
    || ymd(gates?.payroll_eligible_from)
    || ymd(staff?.hired_on)
    || null
}

/**
 * Clamp [from, to] to the staff's payable window.
 * Returns null window if empty (not yet eligible, or fully terminated before period).
 */
export function clampPayWindow({ from, to, staff, gates = null }) {
  const eligibleFrom = resolveEligibleFrom(staff, gates)
  const hired = ymd(staff?.hired_on)
  const term = ymd(staff?.terminated_on)
  let start = ymd(from)
  let end = ymd(to)
  const lower = maxDate(eligibleFrom, hired)
  if (lower) start = maxDate(start, lower)
  if (term) end = minDate(end, term)
  if (!start || !end || start > end) {
    return { start: null, end: null, empty: true, eligibleFrom, hired_on: hired, terminated_on: term }
  }
  return { start, end, empty: false, eligibleFrom, hired_on: hired, terminated_on: term }
}

export async function loadHireGates(db, workspaceId, staffId) {
  const { data, error } = await db.from('staff_hire_gates')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('staff_id', staffId)
    .maybeSingle()
  if (error && !/does not exist|relation/i.test(error.message)) throw new Error(error.message)
  return data || null
}

/** True when gates row exists and any required gate date is still null. */
export function gatesBlockPay(gates) {
  if (!gates) return false // no row yet - rely on payroll_eligible_from / hired_on backfill
  const need = ['offer_accepted_on', 'docs_verified_on', 'nric_verified_on', 'start_on', 'first_store_presence_on']
  return need.some((k) => !gates[k])
}

/** True when asOf is on/after resolveEligibleFrom and hire gates are not blocking. */
export function isPayrollEligibleAsOf(staff, asOf, gates = null) {
  if (gatesBlockPay(gates)) return false
  const from = resolveEligibleFrom(staff, gates)
  if (!from) return false
  const day = ymd(asOf)
  if (!day) return false
  return day >= from
}