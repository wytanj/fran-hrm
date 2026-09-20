// Staff pay portal — stable magic-link token, payslip history, live estimate.
// No WhatsApp. Token is long-lived; rotate only via revokePayPortalToken().

import { randomBytes } from 'node:crypto'
import { listMyPayslips, getPayslipByToken } from './payslips.mjs'
import { liveEarningsEstimate, earningsForMonth, loadStaff } from './earnings.mjs'

const TOKEN_RE = /^pp_[A-Za-z0-9_-]{20,}$/

export function generatePayPortalToken() {
  return `pp_${randomBytes(24).toString('base64url')}`
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

export async function resolvePayPortalStaff(db, token) {
  if (!TOKEN_RE.test(String(token || ''))) return null
  const { data, error } = await db.from('staff')
    .select('id, workspace_id, employee_code, display_name, employment_type, employment_status, pay_portal_token')
    .eq('pay_portal_token', token)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data || data.employment_status === 'terminated') return null
  return data
}

export async function payPortalSnapshot(db, token, { settings = {} } = {}) {
  const gate = await resolvePayPortalStaff(db, token)
  if (!gate) return null
  const [estimate, payslips] = await Promise.all([
    liveEarningsEstimate(db, gate.workspace_id, gate.id, { settings }),
    listMyPayslips(db, gate.workspace_id, gate.id),
  ])
  return {
    staff: {
      id: gate.id,
      employee_code: gate.employee_code,
      display_name: gate.display_name,
      employment_type: gate.employment_type,
    },
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
  return earningsForMonth(db, gate.workspace_id, gate.id, month, { settings })
}
