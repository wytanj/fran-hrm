// Staff pay portal — stable magic-link token, payslip history, live estimate.
// No WhatsApp. Token is long-lived; rotate only via revokePayPortalToken().
//
// JT/CoS: same staff_id forever (leave/rejoin = employment_status). Token stays
// valid for active, inactive (soft break), and terminated (formal exit). Live
// estimate + month preview only when status === 'active' AND payroll-eligible
// (existing payroll_eligible_from / hire gates — not a new column).

import { randomBytes } from 'node:crypto'
import { listMyPayslips, getPayslipByToken } from './payslips.mjs'
import { liveEarningsEstimate, earningsForMonth, loadStaff } from './earnings.mjs'
import { loadHireGates, isPayrollEligibleAsOf } from './eligibility.mjs'

const TOKEN_RE = /^pp_[A-Za-z0-9_-]{20,}$/

function todaySgt() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

export function generatePayPortalToken() {
  return `pp_${randomBytes(24).toString('base64url')}`
}

/** Live estimate / month preview: active + payroll-eligible (existing helper). */
export function isPayPortalLiveEligible(staff, { asOf = null, gates = null } = {}) {
  if (!staff || staff.employment_status !== 'active') return false
  return isPayrollEligibleAsOf(staff, asOf || todaySgt(), gates)
}

export async function ensurePayPortalToken(db, workspaceId, staffId) {
  const staff = await loadStaff(db, workspaceId, staffId)
  if (staff.pay_portal_token && TOKEN_RE.test(staff.pay_portal_token)) {
    return { token: staff.pay_portal_token, created: false, staff }
  }
  const token = generatePayPortalToken()
  const { data, error } = await db.from('staff').update({
    pay_portal_token: token,
    updated_at: new Date().toISOString(),
  }).eq('workspace_id', workspaceId).eq('id', staffId)
    .select('id, employee_code, display_name, pay_portal_token').single()
  if (error) throw new Error(error.message)
  return { token, created: true, staff: { ...staff, ...data } }
}

/** Only kill switch for magic link. Terminate / soft-break must NOT call this. */
export async function revokePayPortalToken(db, workspaceId, staffId) {
  const token = generatePayPortalToken()
  const { data, error } = await db.from('staff').update({
    pay_portal_token: token,
    updated_at: new Date().toISOString(),
  }).eq('workspace_id', workspaceId).eq('id', staffId)
    .select('id, pay_portal_token').single()
  if (error) throw new Error(error.message)
  return { token: data.pay_portal_token, rotated: true }
}

/**
 * Resolve staff by magic-link token. Valid for active, inactive, and terminated
 * as long as the token matches TOKEN_RE (not revoked/missing). Does NOT null out
 * on employment_status.
 */
export async function resolvePayPortalStaff(db, token) {
  if (!TOKEN_RE.test(String(token || ''))) return null
  const { data, error } = await db.from('staff')
    .select('id, workspace_id, employee_code, display_name, employment_type, employment_status, hired_on, payroll_eligible_from, pay_portal_token')
    .eq('pay_portal_token', token)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return data
}

export async function payPortalSnapshot(db, token, { settings = {} } = {}) {
  const gate = await resolvePayPortalStaff(db, token)
  if (!gate) return null

  const gates = gate.employment_status === 'active'
    ? await loadHireGates(db, gate.workspace_id, gate.id)
    : null
  const liveEligible = isPayPortalLiveEligible(gate, { gates })

  const [estimate, payslips] = await Promise.all([
    liveEligible
      ? liveEarningsEstimate(db, gate.workspace_id, gate.id, { settings })
      : Promise.resolve(null),
    listMyPayslips(db, gate.workspace_id, gate.id),
  ])

  return {
    staff: {
      id: gate.id,
      employee_code: gate.employee_code,
      display_name: gate.display_name,
      employment_type: gate.employment_type,
      employment_status: gate.employment_status,
    },
    live_eligible: liveEligible,
    estimate,
    payslips: (payslips || []).map((p) => ({
      id: p.id,
      token: p.token,
      status: p.status,
      period_start: p.period_start,
      period_end: p.period_end,
      payment_date: p.payment_date,
      currency: p.currency || 'SGD',
      gross_cents: p.gross_cents,
      net_cents: p.net_cents,
      cpf_employee_cents: p.cpf_employee_cents,
      cpf_employer_cents: p.cpf_employer_cents,
    })),
  }
}

export async function payPortalPayslip(db, portalToken, payslipToken) {
  const gate = await resolvePayPortalStaff(db, portalToken)
  if (!gate) return null
  const slip = await getPayslipByToken(db, gate.workspace_id, payslipToken)
  if (!slip || slip.staff_id !== gate.id) return null
  if (slip.status === 'draft') return null
  return slip
}

export async function payPortalMonth(db, portalToken, month, { settings = {} } = {}) {
  const gate = await resolvePayPortalStaff(db, portalToken)
  if (!gate) return null
  const gates = gate.employment_status === 'active'
    ? await loadHireGates(db, gate.workspace_id, gate.id)
    : null
  if (!isPayPortalLiveEligible(gate, { gates })) return null
  return earningsForMonth(db, gate.workspace_id, gate.id, month, { settings })
}