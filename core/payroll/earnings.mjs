// Live earnings estimate + month earnings JSON (REST pay-portal + MCP + fran-bird).
//
// Rules (SG store ops):
//   - part_time → current Mon–Sun week (hours × hourly_rate); weekly OT → AW
//   - full_time → month-to-date prorated monthly basic + store OT as AW
//   - contractor → hours × hourly_rate over the window (CPF only if cpf_applicable)
//
// OT uses computeHours overtime.weekly_ot_hours × hourly_rate × OT multiplier
// (timeline, else 1.5). Estimates only — issued payslips remain authoritative.

import { hoursWorked } from '../attendance/query.mjs'
import { weekStartOf } from '../hours/compute.mjs'
import { previewStatutory, resolveOtMultiplier } from './statutory.mjs'
import { listMyPayslips } from './payslips.mjs'

const STAFF_COLS = [
  'id', 'workspace_id', 'employee_code', 'display_name', 'employment_type', 'employment_status',
  'hourly_rate_cents', 'monthly_salary_cents', 'date_of_birth', 'race', 'religion',
  'residency', 'cpf_applicable', 'pr_start_date', 'pr_cpf_type', 'shg_opt_out',
  'work_pass_type', 'work_pass_no', 'work_pass_expires_on',
  'bank_name', 'bank_account_no', 'bank_bic', 'bank_account_name',
  'hired_on', 'terminated_on', 'home_store_id', 'pay_portal_token',
].join(', ')

function ymd(d) {
  return d.toISOString().slice(0, 10)
}

function todaySgt() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Singapore', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date())
}

function monthBounds(month) {
  if (!/^\d{4}-\d{2}$/.test(String(month || ''))) throw new Error('month must be YYYY-MM')
  const start = `${month}-01`
  const end = ymd(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)))
  return { start, end, month }
}

function daysInclusive(from, to) {
  const a = new Date(`${from}T00:00:00Z`).getTime()
  const b = new Date(`${to}T00:00:00Z`).getTime()
  return Math.max(0, Math.round((b - a) / 86400_000) + 1)
}

export async function loadStaff(db, workspaceId, staffId) {
  const { data, error } = await db.from('staff').select(STAFF_COLS)
    .eq('workspace_id', workspaceId).eq('id', staffId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Staff not found')
  return data
}

/** Canonical JSON — MCP payroll_earnings_month + fran-bird share this shape. */
export function buildEarningsPayload({
  staff, window, windowEnd, basis, hours, ordinaryCents, additionalCents,
  statutory, ot, notes = [],
}) {
  return {
    schema: 'fran-hrm.payroll_earnings_month.v1',
    staff: {
      id: staff.id,
      employee_code: staff.employee_code,
      display_name: staff.display_name,
      employment_type: staff.employment_type,
      residency: staff.residency,
      cpf_applicable: staff.cpf_applicable,
      pr_cpf_type: staff.pr_cpf_type || null,
      shg_opt_out: !!staff.shg_opt_out,
      religion: staff.religion || null,
      race: staff.race || null,
    },
    period: {
      month: window.month || String(window.start || '').slice(0, 7) || null,
      start: window.start,
      end: windowEnd || window.end,
      basis,
      as_of: todaySgt(),
    },
    hours: {
      total_hours: hours?.total_hours ?? 0,
      days_worked: hours?.days_worked ?? 0,
      weekly_ot_hours: hours?.overtime?.weekly_ot_hours ?? 0,
      daily_ot_hours: hours?.overtime?.daily_ot_hours ?? 0,
      incomplete_entries: hours?.incomplete_entries ?? 0,
      by_week: hours?.by_week || [],
    },
    wages: {
      ordinary_wages_cents: ordinaryCents,
      additional_wages_cents: additionalCents,
      store_ot_as_aw_cents: additionalCents,
      gross_cents: ordinaryCents + additionalCents,
      currency: 'SGD',
      hourly_rate_cents: staff.hourly_rate_cents || null,
      monthly_salary_cents: staff.monthly_salary_cents || null,
      ot_multiplier: ot?.multiplier ?? null,
      ot_rate_source: ot?.rate_source ?? null,
    },
    statutory_preview: statutory,
    notes,
    disclaimer:
      'Estimate only — not a payslip. Issued payslips are authoritative. CPF/SHG/SDL figures are previews from timeline/fallback rates.',
  }
}

export async function liveEarningsEstimate(db, workspaceId, staffId, { asOf = null, settings = {} } = {}) {
  const staff = await loadStaff(db, workspaceId, staffId)
  const today = asOf || todaySgt()
  const et = staff.employment_type
  const notes = []

  let start
  let end
  let basis
  if (et === 'part_time') {
    start = weekStartOf(today)
    const sun = new Date(`${start}T00:00:00Z`)
    sun.setUTCDate(sun.getUTCDate() + 6)
    end = ymd(sun)
    if (end > today) end = today
    basis = 'pt_week'
    notes.push('Part-time estimate: current week (Mon–Sun) hours × hourly rate; weekly OT → AW.')
  } else if (et === 'full_time') {
    start = `${today.slice(0, 7)}-01`
    end = today
    basis = 'ft_mtd'
    notes.push('Full-time estimate: MTD prorated monthly basic + store OT as Additional Wages.')
  } else {
    start = `${today.slice(0, 7)}-01`
    end = today
    basis = 'month'
    notes.push('Contractor/other: MTD hours × hourly rate.')
  }

  const hours = await hoursWorked(db, workspaceId, { staff_id: staffId, from: start, to: end }, settings)
  const ot = await resolveOtMultiplier(db, workspaceId, today)
  const rate = Number(staff.hourly_rate_cents) || 0
  const otHours = Number(hours.overtime?.weekly_ot_hours) || 0
  const otCents = Math.round(otHours * rate * ot.multiplier)

  let ordinaryCents = 0
  const additionalCents = otCents

  if (et === 'full_time') {
    const monthly = Number(staff.monthly_salary_cents) || 0
    const { end: monthEnd } = monthBounds(today.slice(0, 7))
    const dim = daysInclusive(start, monthEnd)
    const elapsed = daysInclusive(start, end)
    ordinaryCents = dim > 0 ? Math.round(monthly * elapsed / dim) : 0
    if (!monthly) notes.push('monthly_salary_cents missing — ordinary wages shown as 0.')
  } else {
    const worked = Math.max(0, (Number(hours.total_hours) || 0) - otHours)
    ordinaryCents = Math.round(worked * rate)
    if (!rate) notes.push('hourly_rate_cents missing — wage estimate is 0.')
  }

  const statutory = await previewStatutory(db, workspaceId, {
    staff,
    onDate: today,
    ordinaryWagesCents: ordinaryCents,
    additionalWagesCents: additionalCents,
  })

  return buildEarningsPayload({
    staff,
    window: { start, end, month: today.slice(0, 7) },
    windowEnd: end,
    basis,
    hours,
    ordinaryCents,
    additionalCents,
    statutory,
    ot,
    notes,
  })
}

export async function earningsForMonth(db, workspaceId, staffId, month, { settings = {} } = {}) {
  const staff = await loadStaff(db, workspaceId, staffId)
  const { start, end } = monthBounds(month)
  const today = todaySgt()
  const cappedEnd = end > today ? today : end
  const notes = []
  if (end > today) notes.push(`Month still open — hours/wages capped at ${today}.`)

  const hours = await hoursWorked(db, workspaceId, { staff_id: staffId, from: start, to: cappedEnd }, settings)
  const ot = await resolveOtMultiplier(db, workspaceId, cappedEnd)
  const rate = Number(staff.hourly_rate_cents) || 0
  const otHours = Number(hours.overtime?.weekly_ot_hours) || 0
  const otCents = Math.round(otHours * rate * ot.multiplier)

  let ordinaryCents = 0
  const additionalCents = otCents
  const et = staff.employment_type

  if (et === 'full_time') {
    const monthly = Number(staff.monthly_salary_cents) || 0
    if (cappedEnd === end) ordinaryCents = monthly
    else {
      const dim = daysInclusive(start, end)
      const elapsed = daysInclusive(start, cappedEnd)
      ordinaryCents = dim > 0 ? Math.round(monthly * elapsed / dim) : 0
    }
    notes.push('FT: monthly basic as OW; store OT hours × rate × multiplier as AW.')
  } else {
    const worked = Math.max(0, (Number(hours.total_hours) || 0) - otHours)
    ordinaryCents = Math.round(worked * rate)
    notes.push('PT/contractor: worked hours (excl. weekly OT) × hourly rate as OW; weekly OT as AW.')
  }

  const statutory = await previewStatutory(db, workspaceId, {
    staff,
    onDate: cappedEnd,
    ordinaryWagesCents: ordinaryCents,
    additionalWagesCents: additionalCents,
  })

  const payslips = await listMyPayslips(db, workspaceId, staffId)
  const monthSlips = (payslips || []).filter((p) => String(p.period_end || '').slice(0, 7) === month)

  const payload = buildEarningsPayload({
    staff,
    window: { start, end, month },
    windowEnd: cappedEnd,
    basis: 'month',
    hours,
    ordinaryCents,
    additionalCents,
    statutory,
    ot,
    notes,
  })
  payload.payslips = monthSlips.map((p) => ({
    id: p.id,
    token: p.token,
    status: p.status,
    period_start: p.period_start,
    period_end: p.period_end,
    payment_date: p.payment_date,
    gross_cents: p.gross_cents,
    net_cents: p.net_cents,
    cpf_employee_cents: p.cpf_employee_cents,
    cpf_employer_cents: p.cpf_employer_cents,
  }))
  return payload
}
