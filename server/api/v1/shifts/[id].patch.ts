import { recordAudit } from '../../../../core/audit/record.mjs'
import { assertTime, sgTimestamp } from '../../../utils/dates'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const { data: before } = await db
    .from('shifts').select('*').eq('workspace_id', ctx.workspaceId).eq('id', getRouterParam(event, 'id')).maybeSingle()
  if (!before) throw apiError(404, 'Shift not found')

  const patch: Record<string, any> = { updated_at: new Date().toISOString() }
  if (body.staff_id !== undefined) patch.staff_id = body.staff_id || null
  if (body.start_time) patch.start_at = sgTimestamp(before.work_date, assertTime(body.start_time, 'start_time'))
  if (body.end_time) patch.end_at = sgTimestamp(before.work_date, assertTime(body.end_time, 'end_time'))
  if (body.break_minutes !== undefined) patch.break_minutes = Math.max(0, Number(body.break_minutes) || 0)
  if (body.job_code !== undefined) patch.job_code = body.job_code || null
  if (body.notes !== undefined) patch.notes = body.notes || null
  if (body.status && ['scheduled', 'cancelled'].includes(body.status)) patch.status = body.status

  const { data, error } = await db.from('shifts').update(patch).eq('id', before.id).select().single()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'shifts', entity_id: data.id, operation: 'UPDATE', before_data: before, after_data: data,
    metadata: { roster_id: before.roster_id, store_id: before.store_id, reason: body.reason || null },
  })
  return { data }
})
