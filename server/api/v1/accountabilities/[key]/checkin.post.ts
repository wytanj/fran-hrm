import { recordAudit } from '../../../../../core/audit/record.mjs'
import { assertDate } from '../../../../utils/dates'

// Recording a review is a supervisory act, gated by org:write in the matrix.

// Record a periodic review. This is what a weekly or monthly meeting writes
// back, and it also moves the accountability's own status so the register
// reflects reality between meetings.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'org:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const { data: acc } = await db.from('accountabilities')
    .select('id, key, name, status').eq('workspace_id', ctx.workspaceId)
    .eq('key', getRouterParam(event, 'key')).maybeSingle()
  if (!acc) throw apiError(404, 'Accountability not found')

  const periodStart = assertDate(body?.period_start, 'period_start')
  const status = body?.status || 'active'
  if (!['active', 'at_risk', 'paused', 'retired'].includes(status)) {
    throw apiError(400, 'status must be active | at_risk | paused | retired')
  }

  const { data, error } = await db.from('accountability_checkins').upsert({
    workspace_id: ctx.workspaceId,
    accountability_id: acc.id,
    period_start: periodStart,
    period_end: body.period_end || null,
    metric_value: body.metric_value ?? null,
    status,
    note: body.note || null,
    recorded_by: ctx.kind === 'session' ? ctx.staff.id : null,
  }, { onConflict: 'accountability_id,period_start' }).select().single()
  if (error) throw apiError(400, error.message)

  // Keep the register honest: the latest check-in drives the headline status.
  if (status !== acc.status) {
    await db.from('accountabilities')
      .update({ status, updated_at: new Date().toISOString() }).eq('id', acc.id)
  }

  await recordAudit(db, {
    workspace_id: ctx.workspaceId,
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'accountability_checkins', entity_id: data.id, operation: 'INSERT',
    after_data: data,
    metadata: { accountability: acc.key, status_changed: status !== acc.status },
  })
  return { data, accountability_status: status }
})
