// Create a draft payslip. Financial processing — payroll:process (finance/HQ).
import { recordAudit } from '../../../../../core/audit/record.mjs'
// @ts-ignore .mjs shared module
import { createPayslip } from '../../../../../core/payroll/payslips.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'payroll:process' })
  const body = await readBody(event)
  const db = getAdminClient()

  const slip = await createPayslip(db, ctx.workspaceId, body, {
    actorStaffId: ctx.kind === 'session' ? ctx.staff.id : null,
  }).catch((err: any) => { throw apiError(422, err.message) })

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'payslips', entity_id: slip.id, operation: 'INSERT',
    metadata: { action: 'create_payslip', staff_id: slip.staff_id, period: `${slip.period_start}..${slip.period_end}`, net_cents: slip.net_cents },
  })
  return { data: slip }
})
