// A staff member's own payslips (self-service, identity-scoped — no payroll
// scope needed; you only ever see your own).
// @ts-ignore .mjs shared module
import { listMyPayslips } from '../../../../../core/payroll/payslips.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (ctx.kind !== 'session') throw apiError(400, 'Sign in to view your payslips.')
  const db = getAdminClient()
  return { data: await listMyPayslips(db, ctx.workspaceId, ctx.staff.id) }
})
