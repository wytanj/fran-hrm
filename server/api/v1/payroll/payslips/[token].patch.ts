// Edit a DRAFT payslip's figures. payroll:process (finance/HQ).
import { recordAudit } from '../../../../../core/audit/record.mjs'
// @ts-ignore .mjs shared module
import { updateDraft } from '../../../../../core/payroll/payslips.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'payroll:process' })
  const body = await readBody(event)
  const db = getAdminClient()

  const { data: cur } = await db.from('payslips').select('id')
    .eq('workspace_id', ctx.workspaceId).eq('token', String(getRouterParam(event, 'token'))).maybeSingle()
  if (!cur) throw apiError(404, 'Payslip not found')

  const updated = await updateDraft(db, ctx.workspaceId, cur.id, body).catch((err: any) => { throw apiError(422, err.message) })
  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'payslips', entity_id: cur.id, operation: 'UPDATE',
    metadata: { action: 'edit_payslip_draft', net_cents: updated.net_cents },
  })
  return { data: updated }
})
