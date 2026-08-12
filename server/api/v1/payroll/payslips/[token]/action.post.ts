// Payslip lifecycle + comments in one place, with per-action authorisation:
//   issue / revert       → finance (payroll:process)
//   acknowledge / dispute → the staff member it belongs to (both parties sign)
//   comment              → owner or finance (append-only dispute log)
import { recordAudit } from '../../../../../../core/audit/record.mjs'
// @ts-ignore .mjs shared module
import { issuePayslip, revertToDraft, acknowledgePayslip, disputePayslip, addComment } from '../../../../../../core/payroll/payslips.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (ctx.kind !== 'session' && !ctx.has('payroll:process')) throw apiError(401, 'Sign in required.')
  const body = await readBody(event)
  const db = getAdminClient()
  const action = String(body?.action || '')

  const { data: slip } = await db.from('payslips').select('id, staff_id, status')
    .eq('workspace_id', ctx.workspaceId).eq('token', String(getRouterParam(event, 'token'))).maybeSingle()
  if (!slip) throw apiError(404, 'Payslip not found')

  const isOwner = ctx.kind === 'session' && slip.staff_id === ctx.staff.id
  const isFinance = ctx.has('payroll:process')
  const actorStaffId = ctx.kind === 'session' ? ctx.staff.id : null
  const audit = (metadata: any) => recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'payslips', entity_id: slip.id, operation: 'ACTION', metadata,
  })

  try {
    if (action === 'issue') {
      if (!isFinance) throw apiError(403, 'Only finance/HQ can issue a payslip.')
      const data = await issuePayslip(db, ctx.workspaceId, slip.id, actorStaffId)
      await audit({ action: 'issue_payslip' })
      return { data, note: 'Issued. The staff member can now acknowledge or dispute it.' }
    }
    if (action === 'revert') {
      if (!isFinance) throw apiError(403, 'Only finance/HQ can revert a payslip.')
      const data = await revertToDraft(db, ctx.workspaceId, slip.id)
      if (body.reason) await addComment(db, ctx.workspaceId, slip.id, { authorStaffId: actorStaffId, authorName: ctx.actorName, body: body.reason, kind: 'resolution' })
      await audit({ action: 'revert_payslip', reason: body.reason || null })
      return { data, note: 'Reverted to draft — amend and re-issue.' }
    }
    if (action === 'acknowledge') {
      if (!isOwner) throw apiError(403, 'Only the employee named on the payslip can acknowledge it.')
      const data = await acknowledgePayslip(db, ctx.workspaceId, slip.id)
      await audit({ action: 'acknowledge_payslip' })
      return { data, note: 'Acknowledged. Both parties have signed off.' }
    }
    if (action === 'dispute') {
      if (!isOwner) throw apiError(403, 'Only the employee named on the payslip can dispute it.')
      if (!body.reason?.trim()) throw apiError(400, 'A reason is required to raise a dispute.')
      const data = await disputePayslip(db, ctx.workspaceId, slip.id)
      await addComment(db, ctx.workspaceId, slip.id, { authorStaffId: actorStaffId, authorName: ctx.actorName, body: body.reason, kind: 'dispute' })
      await audit({ action: 'dispute_payslip', reason: body.reason })
      return { data, note: 'Dispute raised and logged.' }
    }
    if (action === 'comment') {
      if (!isOwner && !isFinance) throw apiError(403, 'Not allowed to comment on this payslip.')
      if (!body.body?.trim()) throw apiError(400, 'A comment is required.')
      const comment = await addComment(db, ctx.workspaceId, slip.id, { authorStaffId, authorName: ctx.actorName, body: body.body, kind: body.kind })
      return { data: comment }
    }
    throw apiError(400, 'action must be issue | revert | acknowledge | dispute | comment')
  } catch (err: any) {
    if (err.statusCode) throw err
    throw apiError(422, err.message)
  }
})
