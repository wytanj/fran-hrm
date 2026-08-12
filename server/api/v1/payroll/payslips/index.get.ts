// List payslips (finance/HQ view). payroll:process.
// @ts-ignore .mjs shared module
import { listPayslips } from '../../../../../core/payroll/payslips.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'payroll:process' })
  const q = getQuery(event)
  const db = getAdminClient()
  const data = await listPayslips(db, ctx.workspaceId, {
    status: q.status ? String(q.status) : undefined,
    staffId: q.staff_id ? String(q.staff_id) : undefined,
    from: q.from ? String(q.from) : undefined,
    to: q.to ? String(q.to) : undefined,
  })
  return { data }
})
