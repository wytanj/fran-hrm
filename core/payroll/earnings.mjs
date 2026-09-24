// Live earnings estimate + month earnings JSON (REST pay-portal + MCP + fran-bird).
//
// Rules (SG store ops):
//   - part_time â†’ current Monâ€“Sun week (hours Ã— hourly_rate); weekly OT â†’ AW
//   - full_time â†’ month-to-date prorated monthly basic + store OT as AW
//   - contractor â†’ hours Ã— hourly_rate over the window (CPF only if cpf_applicable)
//
// OT uses computeHours overtime.weekly_ot_hours Ã— hourly_rate Ã— OT multiplier
// (timeline, else 1.5). Estimates only â€” issued payslips remain authoritative.

import { hoursWorked } from '../attendance/query.mjs'
import { weekStartOf } from '../hours/compute.mjs'
import { previewStatutory, resolveOtMultiplier } from './statutory.mjs'
import { listMyPayslips } from './payslips.mjs'
import { computeMonthlyProration } from './compute.mjs'
import { clampPayWindow, loadHireGates, gatesBlockPay } from './eligibility.mjs'
import { listTimeEntries } from '../attendance/query.mjs'

const STAFF_COLS = [
  'id', 'workspace_id', 'employee_code', 'display_name', 'employment_type', 'employment_status',
  'hourly_rate_cents', 'monthly_salary_cents', 'date_of_birth', 'race', 'religion',
  'residency', 'cpf_applicable', 'pr_start_date', 'pr_cpf_type', 'shg_opt_out',
  'work_pass_type', 'work_pass_no', 'work_pass_expires_on',
  'bank_name', 'bank_account_no', 'bank_bic', 'bank_account_name',
  'hired_on', 'terminated_on', 'payroll_eligible_from', 'home_store_id', 'pay_portal_token',
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


/** HQ store-cover hours tagged job_code=hq_store_cover â†’ AW (not OW). */
async function hqCoverHours(db, workspaceId, staffId, from, to) {
  if (!from || !to) return { hours: 0, entries: 0 }
  const { data } = await listTimeEntries(db, workspaceId, { staff_id: staffId, from, to, limit: 500 })
  let hours = 0
  let entries = 0
  for (const e of data || []) {
    if (String(e.job_code || "") !== "hq_store_cover") continue
    if (!e.clock_in_at || !e.clock_out_at) continue
    const ms = new Date(e.clock_out_at) - new Date(e.clock_in_at)
    const br = Number(e.break_minutes) || 0
    hours += Math.max(0, ms / 3600000 - br / 60)
    entries += 1
  }
  return { hours: Math.round(hours * 100) / 100, entries }
}

export async function loadStaff(db, workspaceId, staffId) {
  const { data, error } = await db.from('staff').select(STAFF_COLS)
    .eq('workspace_id', workspaceId).eq('id', staffId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('Staff not found')
  return data
}

/** Canonical JSON â€” MCP payroll_earnings_month + fran-bird share this shape. */
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
      'Estimate only â€” not a payslip. Issued payslips are authoritative. CPF/SHG/SDL figures are previews from timeline/fallback rates.',
  }
}


async function computeMatrixEarnings(db, workspaceId, staff, { start, end, basis, settings = {}, notes = [] }) {
  const gates = await loadHireGates(db, workspaceId, staff.id)
  const clamp = clampPayWindow({ from: start, to: end, staff, gates })
  applyEligibilityNotes(notes, clamp, gates)

  if (clamp.empty || gatesBlockPay(gates)) {
    const ot = await resolveOtMultiplier(db, workspaceId, end)
    const statutory = await previewStatutory(db, workspaceId, {
      staff, onDate: end, ordinaryWagesCents: 0, additionalWagesCents: 0,
    })
    notes.push('Chicken-out / ineligible: OW and AW set to 0.')
    return {
      hours: { total_hours: 0, days_worked: 0, overtime: { weekly_ot_hours: 0, daily_ot_hours: 0 }, incomplete_entries: 0, by_week: [] },
      ordinaryCents: 0,
      additionalCents: 0,
      statutory,
      ot,
      notes,
      clamp,
    }
  }

  const from = clamp.start
  const to = clamp.end
  const hours = await hoursWorked(db, workspaceId, { staff_id: staff.id, from, to }, settings)
  const ot = await resolveOtMultiplier(db, workspaceId, to)
  const rate = Number(staff.hourly_rate_cents) || 0
  const otHours = Number(hours.overtime?.weekly_ot_hours) || 0
  let otCents = Math.round(otHours * rate * ot.multiplier)

  const cover = await hqCoverHours(db, workspaceId, staff.id, from, to)
  const coverCents = Math.round(cover.hours * rate * (ot.multiplier > 1 ? 1 : 1))
  // Cover is AW at straight hourly (OT multiplier already in weekly OT bucket if those hours overlap).
  // Prefer tagging: cover hours counted as AW; do not double-count into OW.
  if (cover.hours > 0) notes.push(`HQ store cover ${cover.hours}h (job_code=hq_store_cover) → AW (${cover.entries} entries).`)

  const clockHours = Number(hours.total_hours) || 0
  const chickenOut = clockHours <= 0
  if (chickenOut) notes.push('No QR/clock hours in payable window — ordinary wages forced to 0 (no phantom FT basic).')

  let ordinaryCents = 0
  let additionalCents = otCents + coverCents
  const et = staff.employment_type

  if (et === 'full_time') {
    const monthly = Number(staff.monthly_salary_cents) || 0
    if (chickenOut) {
      ordinaryCents = 0
    } else {
      const pr = await computeMonthlyProration(db, workspaceId, {
        staffId: staff.id,
        periodStart: from,
        periodEnd: to,
        monthlyBasicCents: monthly,
      })
      ordinaryCents = pr.prorated_basic_cents
      if (pr.no_pay_days > 0) {
        notes.push(`FT unpaid leave: ${pr.no_pay_days} no-pay day(s); OW prorated via computeMonthlyProration.`)
      } else {
        notes.push('FT: monthly basic via computeMonthlyProration (unpaid leave aware) + store OT/cover as AW.')
      }
      if (!monthly) notes.push('monthly_salary_cents missing — ordinary wages shown as 0.')
    }
  } else {
    const worked = Math.max(0, clockHours - otHours - cover.hours)
    ordinaryCents = chickenOut ? 0 : Math.round(worked * rate)
    notes.push('PT/contractor: worked hours (excl. weekly OT + hq cover) × hourly rate as OW; OT + cover as AW.')
    if (!rate) notes.push('hourly_rate_cents missing — wage estimate is 0.')
  }

  const statutory = await previewStatutory(db, workspaceId, {
    staff,
    onDate: to,
    ordinaryWagesCents: ordinaryCents,
    additionalWagesCents: additionalCents,
  })

  return { hours, ordinaryCents, additionalCents, statutory, ot, notes, clamp, from, to }
}

function applyEligibilityNotes(notes, clamp, gates) {
  if (clamp.eligibleFrom) notes.push(`Payable window uses payroll_eligible_from/hired_on/terminated_on (eligible_from=${clamp.eligibleFrom}).`)
  if (gatesBlockPay(gates)) notes.push('Hire gates incomplete — wages forced to 0 until offer/docs/NRIC/start/first QR presence.')
  if (clamp.empty) notes.push('No overlap with eligible employment window — wages 0.')
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
  } else {
    start = `${today.slice(0, 7)}-01`
    end = today
    basis = et === 'full_time' ? 'ft_mtd' : 'month'
  }

  const result = await computeMatrixEarnings(db, workspaceId, staff, { start, end, basis, settings, notes })
  return buildEarningsPayload({
    staff,
    window: { start: result.from || start, end: result.to || end, month: today.slice(0, 7) },
    windowEnd: result.to || end,
    basis,
    hours: result.hours,
    ordinaryCents: result.ordinaryCents,
    additionalCents: result.additionalCents,
    statutory: result.statutory,
    ot: result.ot,
    notes: result.notes,
  })
}

export async function earningsForMonth(db, workspaceId, staffId, month, { settings = {} } = {}) {
  const staff = await loadStaff(db, workspaceId, staffId)
  const { start, end } = monthBounds(month)
  const today = todaySgt()
  const cappedEnd = end > today ? today : end
  const notes = []
  if (end > today) notes.push(`Month still open — hours/wages capped at ${today}.`)

  const result = await computeMatrixEarnings(db, workspaceId, staff, {
    start, end: cappedEnd, basis: 'month', settings, notes,
  })

  const payslips = await listMyPayslips(db, workspaceId, staffId)
  const monthSlips = (payslips || []).filter((p) => String(p.period_end || '').slice(0, 7) === month)

  const payload = buildEarningsPayload({
    staff,
    window: { start, end, month },
    windowEnd: result.to || cappedEnd,
    basis: 'month',
    hours: result.hours,
    ordinaryCents: result.ordinaryCents,
    additionalCents: result.additionalCents,
    statutory: result.statutory,
    ot: result.ot,
    notes: result.notes,
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
