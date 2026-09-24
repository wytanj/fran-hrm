import { resolveShgAgency } from './statutory.mjs'
import { earningsForMonth } from './earnings.mjs'
// Generate the CPF EZPay upload CSV from FranHRM's earnings engine +
// staff CPF fields for a month (same path as Aspire). Issue/payslips are
// separate — for My payslips after payday.

// Exact template header (order + labels matter for the EZPay upload).
export const CPF_EZPAY_HEADER = [
  '* CPF Account No (SXXXXXXXA)',
  '* Name of Employee (as per NRIC)',
  '* Ordinary Wages ($)',
  '* Additional Wages ($) ',
  'Agency Fund ($)',
  'Agency (CDAC/ MBMF/ SINDA/ ECF)',
  "* Citizenship ('1' for PR Yr 1 / '2' for PR Yr 2 / '3' for Singaporean/PR YR 3)",
  'PR Start Date (DD.MMM.YYYY)',
  'Type (F/G for Full/Graduated, G/G for Graduated/Graduated)',
  '* Employment Status (Existing / Left / New / New & Leaving)',
  'Date Left Employment (DD.MMM.YYYY)',
  '* Date of Birth (DD.MMM.YYYY)',
  '* SDL Payable (Yes / No)',
]

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const RACE_TO_SHG = { chinese: 'CDAC', malay: 'MBMF', muslim: 'MBMF', indian: 'SINDA', eurasian: 'ECF' }

const dollars = (cents) => ((Number(cents) || 0) / 100).toFixed(2)
const shgFund = (race) => RACE_TO_SHG[String(race || '').toLowerCase()] || ''

function fmtDob(d) {
  if (!d) return ''
  const s = String(d).slice(0, 10)
  const [y, m, day] = s.split('-')
  if (!y || !m || !day) return ''
  return `${day}.${MONTHS[Number(m) - 1] || m}.${y}`
}

function inMonth(dateStr, month) {
  return typeof dateStr === 'string' && dateStr.slice(0, 7) === month
}

function citizenshipCode(staff, monthEnd) {
  if (staff.residency === 'citizen') return '3'
  if (staff.residency === 'pr') {
    if (!staff.pr_start_date) return '3'
    const years = (new Date(`${monthEnd}T00:00:00Z`).getTime() - new Date(`${String(staff.pr_start_date).slice(0, 10)}T00:00:00Z`).getTime()) / (365.25 * 86400_000)
    return years < 1 ? '1' : years < 2 ? '2' : '3'
  }
  return '3' // default to Singaporean when unspecified but CPF-applicable
}

function employmentStatus(staff, month) {
  const joined = inMonth(staff.hired_on, month)
  const left = inMonth(staff.terminated_on, month)
  if (joined && left) return 'New & Leaving'
  if (left) return 'Left'
  if (joined) return 'New'
  return 'Existing'
}

function csvCell(v) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/**
 * @returns {Promise<{ csv, count, skipped: Array<{name, reason}> }>}
 */
export async function generateCpfEzpay(db, workspaceId, { month }) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new Error('month must be YYYY-MM')
  const monthEnd = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10)

  const { data: staffRows, error } = await db.from('staff')
    .select('id, display_name, nric, date_of_birth, race, residency, cpf_applicable, pr_start_date, pr_cpf_type, hired_on, terminated_on, religion, shg_opt_out')
    .eq('workspace_id', workspaceId)
    .in('employment_status', ['active', 'terminated'])
  if (error) throw new Error(error.message)

  const rows = [CPF_EZPAY_HEADER]
  const skipped = []
  for (const s of staffRows || []) {
    const name = s.display_name
    if (s.cpf_applicable === false || s.residency === 'foreigner') { skipped.push({ name, reason: 'not CPF-applicable' }); continue }
    if (!s.nric) { skipped.push({ name, reason: 'missing NRIC' }); continue }

    let earnings
    try {
      earnings = await earningsForMonth(db, workspaceId, s.id, month)
    } catch (e) {
      skipped.push({ name, reason: e.message })
      continue
    }
    const ow = Number(earnings?.wages?.ordinary_wages_cents) || 0
    const aw = Number(earnings?.wages?.additional_wages_cents) || 0
    const gross = Number(earnings?.wages?.gross_cents) || 0
    if (gross <= 0) {
      skipped.push({ name, reason: 'zero gross (ineligible / no QR / chicken-out)' })
      continue
    }

    rows.push([
      s.nric, name, dollars(ow), dollars(aw),
      '', resolveShgAgency(s) || '',
      citizenshipCode(s, monthEnd),
      s.residency === 'pr' ? fmtDob(s.pr_start_date) : '',
      s.residency === 'pr' ? (s.pr_cpf_type || '') : '',
      employmentStatus(s, month),
      inMonth(s.terminated_on, month) ? fmtDob(s.terminated_on) : '',
      fmtDob(s.date_of_birth),
      'Yes',
    ])
  }
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  return { csv, count: rows.length - 1, skipped }
}
