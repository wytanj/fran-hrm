import { recordAudit } from '../../../../core/audit/record.mjs'

// Staff-initiated swap: give my shift to an eligible teammate, optionally
// taking one of theirs in return. Cutoff: requests inside swap_cutoff_hours
// of the shift start are rejected.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const body = await readBody(event)
  const db = getAdminClient()

  const { data: shift } = await db
    .from('shifts').select('*').eq('workspace_id', ctx.workspaceId).eq('id', body?.shift_id).maybeSingle()
  if (!shift) throw apiError(404, 'Shift not found')

  const requesterId = ctx.kind === 'session' ? ctx.staff.id : body.requested_by
  if (!requesterId) throw apiError(400, 'requested_by is required for API-key callers')
  if (ctx.kind === 'session' && shift.staff_id !== ctx.staff.id) {
    throw apiError(403, 'You can only offer your own shifts for swap')
  }
  if (!body.counterpart_staff_id) throw apiError(400, 'counterpart_staff_id is required')

  const settings = await getWorkspaceSettings(ctx.workspaceId)
  const cutoffHours = Number(settings.swap_cutoff_hours) || 24
  if (new Date(shift.start_at).getTime() - Date.now() < cutoffHours * 3600_000) {
    throw apiError(422, `Swap requests must be made at least ${cutoffHours}h before the shift starts`)
  }

  if (body.counterpart_shift_id) {
    const { data: cShift } = await db
      .from('shifts').select('staff_id').eq('workspace_id', ctx.workspaceId).eq('id', body.counterpart_shift_id).maybeSingle()
    if (!cShift || cShift.staff_id !== body.counterpart_staff_id) {
      throw apiError(422, 'counterpart_shift_id must belong to the counterpart staff member')
    }
  }

  const { data, error } = await db.from('shift_swaps').insert({
    workspace_id: ctx.workspaceId,
    shift_id: shift.id,
    requested_by: requesterId,
    counterpart_staff_id: body.counterpart_staff_id,
    counterpart_shift_id: body.counterpart_shift_id || null,
    reason: body.reason || null,
  }).select().single()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'shift_swaps', entity_id: data.id, operation: 'INSERT', after_data: data,
  })
  return { data }
})
