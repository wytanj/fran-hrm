import { recordAudit } from '../../../../../../core/audit/record.mjs'

// SM+ approves/rejects leave. Approval debits the balance for entitled types.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'leave:approve' })
  const body = await readBody(event)
  const db = getAdminClient()

  const decision = String(body?.decision || '')
  if (!['approved', 'rejected'].includes(decision)) {
    throw apiError(400, 'decision must be approved | rejected')
  }

  const { data: req } = await db
    .from('leave_requests').select('*, leave_type:leave_type_id(code, default_days_per_year)')
    .eq('workspace_id', ctx.workspaceId).eq('id', getRouterParam(event, 'id')).maybeSingle()
  if (!req) throw apiError(404, 'Leave request not found')
  if (req.status !== 'pending') throw apiError(409, `Request is already ${req.status}`)

  if (decision === 'approved' && Number(req.leave_type?.default_days_per_year) > 0) {
    const year = Number(String(req.start_date).slice(0, 4))
    const { data: balance } = await db
      .from('leave_balances').select('*')
      .eq('staff_id', req.staff_id).eq('leave_type_id', req.leave_type_id).eq('year', year).maybeSingle()
    if (balance) {
      await db.from('leave_balances')
        .update({ used_days: Number(balance.used_days) + Number(req.days), updated_at: new Date().toISOString() })
        .eq('id', balance.id)
    }
  }

  const { data, error } = await db.from('leave_requests').update({
    status: decision,
    decided_by: ctx.kind === 'session' ? ctx.staff.id : null,
    decided_at: new Date().toISOString(),
    decision_note: body.note || null,
  }).eq('id', req.id).select().single()
  if (error) throw apiError(500, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'leave_requests', entity_id: req.id, operation: 'ACTION',
    before_data: { status: 'pending' }, after_data: { status: decision },
    metadata: { action: 'decide_leave', days: req.days },
  })
  return { data }
})
