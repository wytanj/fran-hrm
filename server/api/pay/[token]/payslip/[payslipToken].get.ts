// GET /api/pay/:token/payslip/:payslipToken — one issued payslip via magic link.
// @ts-ignore .mjs
import { payPortalPayslip } from '../../../../../core/payroll/payPortal.mjs'

export default defineEventHandler(async (event) => {
  const token = String(getRouterParam(event, 'token') || '')
  const payslipToken = String(getRouterParam(event, 'payslipToken') || '')
  const db = getAdminClient()
  const slip = await payPortalPayslip(db, token, payslipToken)
  if (!slip) throw apiError(404, 'Payslip not found.')
  return { data: slip }
})
