// Preview monthly-pay proration for approved no-pay leave / sabbatical, before
// creating a payslip. payroll:process.
// @ts-ignore .mjs shared module
import { computeMonthlyProration } from '../../../../core/payroll/compute.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'payroll:process' })
  const q = getQuery(event)
  const staffId = String(q.staff_id || '')
  const periodStart = String(q.period_start || '')
  const periodEnd = String(q.period_end || '')
  if (!staffId || !periodStart || !periodEnd) throw apiError(400, 'staff_id, period_start and period_end are required')

  const db = getAdminClient()
  return {
    data: await computeMonthlyProration(db, ctx.workspaceId, {
      staffId, periodStart, periodEnd, monthlyBasicCents: Number(q.monthly_basic_cents) || 0,
    }),
  }
})
