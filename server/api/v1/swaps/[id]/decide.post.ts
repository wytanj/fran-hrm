import { recordAudit } from '../../../../../core/audit/record.mjs'

// Supervisor/SM approves or rejects a swap. Approval reassigns the shift
// (and the counterpart shift when it's a two-way swap).
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const decision = String(body?.decision || '')
  if (!['approved', 'rejected'].includes(decision)) {
    throw apiError(400, 'decision must be approved | rejected')
  }

  const { data: swap } = await db
    .from('shift_swaps').select('*').eq('workspace_id', ctx.workspaceId).eq('id', getRouterParam(event, 'id')).maybeSingle()
  if (!swap) throw apiError(404, 'Swap request not found')
  if (swap.status !== 'pending') throw apiError(409, `Swap is already ${swap.status}`)

  if (decision === 'approved') {
    const { error: e1 } = await db.from('shifts').update({ staff_id: swap.counterpart_staff_id, updated_at: new Date().toISOString() }).eq('id', swap.shift_id)
    if (e1) throw apiError(500, e1.message)
    if (swap.counterpart_shift_id) {
      const { error: e2 } = await db.from('shifts').update({ staff_id: swap.requested_by, updated_at: new Date().toISOString() }).eq('id', swap.counterpart_shift_id)
      if (e2) throw apiError(500, e2.message)
    }
  }

  const { data, error } = await db.from('shift_swaps').update({
    status: decision,
    decided_by: ctx.kind === 'session' ? ctx.staff.id : null,
    decided_at: new Date().toISOString(),
    decision_note: body.note || null,
  }).eq('id', swap.id).select().single()
  if (error) throw apiError(500, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'shift_swaps', entity_id: swap.id, operation: 'ACTION',
    before_data: { status: 'pending' }, after_data: { status: decision },
    metadata: { action: 'decide_swap', shift_id: swap.shift_id },
  })
  return { data }
})
