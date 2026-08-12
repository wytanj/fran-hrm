// Update CPF/EOR pay settings. payroll:settings (finance/HQ). Every change is
// audited with before/after — that log is the control plane.
import { recordAudit } from '../../../../core/audit/record.mjs'
// @ts-ignore .mjs shared module
import { updatePayrollSettings } from '../../../../core/payroll/settings.mjs'

function changedKeys(before: any, after: any) {
  const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
  return [...keys].filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]))
}

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'payroll:settings' })
  const body = await readBody(event)
  const db = getAdminClient()

  const patch = body?.settings ?? body?.patch ?? body
  if (!patch || typeof patch !== 'object') throw apiError(400, 'Provide a `settings` object to update.')

  const { before, after } = await updatePayrollSettings(db, ctx.workspaceId, patch, {
    actorStaffId: ctx.kind === 'session' ? ctx.staff.id : null,
    replace: !!body?.replace,
  })
  const changed = changedKeys(before, after)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId,
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'payroll_settings', entity_id: ctx.workspaceId, operation: 'UPDATE',
    before_data: before, after_data: after,
    metadata: { action: 'update_payroll_settings', changed_keys: changed, reason: body?.reason || null },
  })

  return { data: { settings: after, changed }, note: `Updated payroll settings (${changed.join(', ') || 'no change'}). Logged to the control plane.` }
})
