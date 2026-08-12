// Payslips — Singapore itemised, with employer/staff sign-off and a dispute
// log. Shared by REST (and later MCP). Routes enforce who may call what; this
// layer owns the shape, the totals and the status transitions.
import { randomBytes } from 'node:crypto'
import { computeMonthlyProration } from './compute.mjs'

const num = (v) => Math.round(Number(v) || 0)
const sumItems = (arr) => (Array.isArray(arr) ? arr : []).reduce((s, i) => s + num(i?.cents), 0)
const cleanItems = (arr) => (Array.isArray(arr) ? arr : [])
  .map((i) => ({ label: String(i?.label || '').slice(0, 120), cents: num(i?.cents) }))
  .filter((i) => i.label || i.cents)

/** MOM itemised totals. Gross excludes employer CPF (info only); net is take-home. */
export function computeTotals(p) {
  const gross = num(p.basic_salary_cents) + sumItems(p.allowances) + sumItems(p.additions) + num(p.overtime_pay_cents)
  const net = gross - sumItems(p.deductions) - num(p.cpf_employee_cents)
  return { gross_cents: gross, net_cents: net }
}

function normalise(input) {
  const p = {
    period_start: input.period_start,
    period_end: input.period_end,
    payment_date: input.payment_date || null,
    currency: input.currency || 'SGD',
    basic_salary_cents: num(input.basic_salary_cents),
    allowances: cleanItems(input.allowances),
    additions: cleanItems(input.additions),
    deductions: cleanItems(input.deductions),
    overtime_hours: Number(input.overtime_hours) || 0,
    overtime_pay_cents: num(input.overtime_pay_cents),
    cpf_employee_cents: num(input.cpf_employee_cents),
    cpf_employer_cents: num(input.cpf_employer_cents),
    notes: input.notes || null,
  }
  return { ...p, ...computeTotals(p) }
}

export async function createPayslip(db, workspaceId, input, { actorStaffId = null } = {}) {
  if (!input.staff_id) throw new Error('staff_id is required')
  if (!input.period_start || !input.period_end) throw new Error('period_start and period_end are required')

  const [{ data: ws }, { data: staff }] = await Promise.all([
    db.from('workspaces').select('name').eq('id', workspaceId).maybeSingle(),
    db.from('staff').select('id, display_name').eq('workspace_id', workspaceId).eq('id', input.staff_id).maybeSingle(),
  ])
  if (!staff) throw new Error('Staff member not found in this workspace')

  // Payroll presumes a monthly salary: if a monthly basic is given, prorate it
  // for approved no-pay leave / sabbatical in the period. Same path for UI, API
  // and MCP, so the rule can't diverge.
  let effective = input
  let proration = null
  if (input.monthly_basic_cents != null && input.monthly_basic_cents !== '') {
    proration = await computeMonthlyProration(db, workspaceId, {
      staffId: staff.id, periodStart: input.period_start, periodEnd: input.period_end,
      monthlyBasicCents: input.monthly_basic_cents,
    })
    effective = { ...input, basic_salary_cents: proration.prorated_basic_cents }
    if (proration.no_pay_days > 0) {
      const note = `Basic prorated for ${proration.no_pay_days} no-pay day(s) of ${proration.working_days} working days (monthly ${(proration.monthly_basic_cents / 100).toFixed(2)}).`
      effective.notes = [input.notes, note].filter(Boolean).join(' ')
    }
  }

  const { data, error } = await db.from('payslips').insert({
    workspace_id: workspaceId,
    staff_id: staff.id,
    token: `ps_${randomBytes(16).toString('base64url')}`,
    employer_name: ws?.name || null,
    employee_name: staff.display_name,
    status: 'draft',
    created_by: actorStaffId,
    ...normalise(effective),
  }).select().single()
  if (error) throw new Error(error.message)
  return { ...data, proration }
}

export async function updateDraft(db, workspaceId, id, patch) {
  const { data: cur } = await db.from('payslips').select('*').eq('workspace_id', workspaceId).eq('id', id).maybeSingle()
  if (!cur) throw new Error('Payslip not found')
  if (cur.status !== 'draft') throw new Error('Only draft payslips can be edited. Revert a disputed one to draft first, or issue a corrected payslip.')
  const merged = { ...cur, ...patch }
  const { data, error } = await db.from('payslips').update({
    ...normalise(merged), updated_at: new Date().toISOString(),
  }).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  return data
}

async function transition(db, workspaceId, id, from, patch) {
  const { data: cur } = await db.from('payslips').select('status').eq('workspace_id', workspaceId).eq('id', id).maybeSingle()
  if (!cur) throw new Error('Payslip not found')
  if (Array.isArray(from) ? !from.includes(cur.status) : cur.status !== from) {
    throw new Error(`Payslip is ${cur.status}; expected ${Array.isArray(from) ? from.join('/') : from}.`)
  }
  const { data, error } = await db.from('payslips').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  return data
}

export const issuePayslip = (db, ws, id, actorStaffId) =>
  transition(db, ws, id, 'draft', { status: 'issued', issued_by: actorStaffId, issued_at: new Date().toISOString() })
export const revertToDraft = (db, ws, id) =>
  transition(db, ws, id, ['disputed', 'issued'], { status: 'draft', issued_at: null, disputed_at: null })
export const acknowledgePayslip = (db, ws, id) =>
  transition(db, ws, id, 'issued', { status: 'acknowledged', acknowledged_at: new Date().toISOString() })
export const disputePayslip = (db, ws, id) =>
  transition(db, ws, id, ['issued', 'acknowledged'], { status: 'disputed', disputed_at: new Date().toISOString() })

export async function addComment(db, workspaceId, payslipId, { authorStaffId = null, authorName = null, body, kind = 'comment' }) {
  if (!body || !String(body).trim()) throw new Error('A comment body is required')
  const { data, error } = await db.from('payslip_comments').insert({
    workspace_id: workspaceId, payslip_id: payslipId,
    author_staff_id: authorStaffId, author_name: authorName,
    kind: ['comment', 'dispute', 'resolution'].includes(kind) ? kind : 'comment',
    body: String(body).slice(0, 4000),
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

const SELECT = '*, staff:staff_id(employee_code, display_name)'

export async function listPayslips(db, workspaceId, { status, staffId, from, to, limit = 200 } = {}) {
  let q = db.from('payslips').select(SELECT).eq('workspace_id', workspaceId)
    .order('period_end', { ascending: false }).limit(limit)
  if (status) q = q.eq('status', status)
  if (staffId) q = q.eq('staff_id', staffId)
  if (from) q = q.gte('period_end', from)
  if (to) q = q.lte('period_end', to)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

/** A staff member's own payslips — never drafts (not yet issued to them). */
export async function listMyPayslips(db, workspaceId, staffId) {
  const { data, error } = await db.from('payslips').select('*')
    .eq('workspace_id', workspaceId).eq('staff_id', staffId).neq('status', 'draft')
    .order('period_end', { ascending: false })
  if (error) throw new Error(error.message)
  return data || []
}

export async function getPayslipByToken(db, workspaceId, token) {
  const { data } = await db.from('payslips').select(SELECT).eq('workspace_id', workspaceId).eq('token', token).maybeSingle()
  if (!data) return null
  const { data: comments } = await db.from('payslip_comments').select('*')
    .eq('payslip_id', data.id).order('created_at')
  return { ...data, comments: comments || [] }
}
