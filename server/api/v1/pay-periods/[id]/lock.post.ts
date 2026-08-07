import { recordAudit } from '../../../../../core/audit/record.mjs'

// Approve → lock lifecycle. Locking marks every time entry in the window
// status='locked'. Reopening (action=reopen) requires area_manager+ and is
// audited — the spec's escape hatch for post-payroll fixes.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'payroll:lock' })
  const body = await readBody(event).catch(() => ({}))
  const db = getAdminClient()
  const action = String(body?.action || 'lock')

  const { data: period } = await db
    .from('pay_periods').select('*').eq('workspace_id', ctx.workspaceId).eq('id', getRouterParam(event, 'id')).maybeSingle()
  if (!period) throw apiError(404, 'Pay period not found')

  const now = new Date().toISOString()
  let patch: Record<string, any>
  if (action === 'approve') {
    patch = { status: 'approved', approved_at: now, approved_by: ctx.kind === 'session' ? ctx.staff.id : null }
  } else if (action === 'lock') {
    patch = { status: 'locked', locked_at: now, locked_by: ctx.kind === 'session' ? ctx.staff.id : null }
    await db.from('time_entries')
      .update({ status: 'locked', locked_at: now })
      .eq('workspace_id', ctx.workspaceId)
      .gte('work_date', period.start_date)
      .lte('work_date', period.end_date)
      .neq('status', 'locked')
  } else if (action === 'reopen') {
    patch = { status: 'open', locked_at: null, locked_by: null }
    await db.from('time_entries')
      .update({ status: 'closed', locked_at: null })
      .eq('workspace_id', ctx.workspaceId)
      .gte('work_date', period.start_date)
      .lte('work_date', period.end_date)
      .eq('status', 'locked')
  } else {
    throw apiError(400, 'action must be approve | lock | reopen')
  }

  const { data, error } = await db.from('pay_periods').update(patch).eq('id', period.id).select().single()
  if (error) throw apiError(500, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'pay_periods', entity_id: period.id, operation: 'ACTION',
    before_data: { status: period.status }, after_data: { status: data.status },
    metadata: { action: `pay_period_${action}` },
  })
  return { data }
})
