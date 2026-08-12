// A single payslip by its unique token. Visible to the staff member it belongs
// to, or to finance/HQ. Staff never see an unissued draft.
// @ts-ignore .mjs shared module
import { getPayslipByToken } from '../../../../../core/payroll/payslips.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (ctx.kind !== 'session') throw apiError(401, 'Sign in to view a payslip.')
  const db = getAdminClient()
  const slip = await getPayslipByToken(db, ctx.workspaceId, String(getRouterParam(event, 'token')))
  if (!slip) throw apiError(404, 'Payslip not found')

  const isOwner = slip.staff_id === ctx.staff.id
  const isFinance = ctx.has('payroll:process') || ctx.has('payroll:settings')
  if (!isOwner && !isFinance) throw apiError(404, 'Payslip not found')
  if (slip.status === 'draft' && !isFinance) throw apiError(404, 'Payslip not found')

  return {
    data: slip,
    can: {
      edit: isFinance && slip.status === 'draft',
      issue: isFinance && slip.status === 'draft',
      revert: isFinance && ['issued', 'disputed'].includes(slip.status),
      acknowledge: isOwner && slip.status === 'issued',
      dispute: isOwner && ['issued', 'acknowledged'].includes(slip.status),
      comment: isOwner || isFinance,
    },
  }
})
