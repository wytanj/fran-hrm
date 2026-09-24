// Aspire payout CSV — first-class Payroll download (same earnings engine as ezPay path).
// Columns tuned for Aspire bulk payout upload; amounts in dollars from cents.

import { earningsForMonth } from './earnings.mjs'

const ASPIRE_HEADER = [
  'employee_code',
  'display_name',
  'bank_bic',
  'bank_account_no',
  'bank_account_name',
  'currency',
  'amount_dollars',
  'ordinary_wages_dollars',
  'additional_wages_dollars',
  'payment_reference',
  'month',
  'notes',
]

function dollars(cents) {
  return ((Number(cents) || 0) / 100).toFixed(2)
}

function csvCell(v) {
  const s = v == null ? '' : String(v)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/**
 * Build Aspire payout CSV for a workspace month from the earnings engine
 * (not from draft payslips alone — live matrix rules apply).
 */
export async function generateAspirePayout(db, workspaceId, { month, staffIds = null } = {}) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new Error('month must be YYYY-MM')

  let staffQuery = db.from('staff')
    .select('id, employee_code, display_name, employment_status, bank_bic, bank_account_no, bank_account_name, bank_name')
    .eq('workspace_id', workspaceId)
    .in('employment_status', ['active', 'terminated'])
  if (Array.isArray(staffIds) && staffIds.length) staffQuery = staffQuery.in('id', staffIds)

  const { data: staffRows, error } = await staffQuery
  if (error) throw new Error(error.message)

  const rows = [ASPIRE_HEADER]
  const skipped = []

  for (const s of staffRows || []) {
    let earnings
    try {
      earnings = await earningsForMonth(db, workspaceId, s.id, month)
    } catch (e) {
      skipped.push({ name: s.display_name, reason: e.message })
      continue
    }
    const gross = Number(earnings?.wages?.gross_cents) || 0
    if (gross <= 0) {
      skipped.push({ name: s.display_name, reason: 'zero gross (ineligible / no QR / chicken-out)' })
      continue
    }
    const bic = s.bank_bic || ''
    const acct = s.bank_account_no || ''
    if (!bic || !acct) {
      skipped.push({ name: s.display_name, reason: 'missing bank_bic or bank_account_no' })
      continue
    }
    const notes = (earnings.notes || []).join('; ')
    rows.push([
      s.employee_code || '',
      s.display_name || '',
      bic,
      acct,
      s.bank_account_name || s.display_name || '',
      'SGD',
      dollars(gross),
      dollars(earnings.wages?.ordinary_wages_cents),
      dollars(earnings.wages?.additional_wages_cents),
      `PAY-${month}-${s.employee_code || s.id.slice(0, 8)}`,
      month,
      notes,
    ])
  }

  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  return { csv, count: rows.length - 1, skipped }
}

export { ASPIRE_HEADER }
