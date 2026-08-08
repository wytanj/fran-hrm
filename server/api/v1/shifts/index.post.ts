import { recordAudit } from '../../../../core/audit/record.mjs'
import { assertDate, assertTime, sgTimestamp } from '../../../utils/dates'

// Add a shift to a roster. Accepts either a template_id or explicit
// start_time/end_time (HH:MM, SGT). staff_id may be null = open PT shift.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const { data: roster } = await db
    .from('rosters').select('*').eq('workspace_id', ctx.workspaceId).eq('id', body?.roster_id).maybeSingle()
  if (!roster) throw apiError(404, 'Roster not found')

  const workDate = assertDate(body.work_date, 'work_date')
  let startTime = body.start_time
  let endTime = body.end_time
  let breakMinutes = body.break_minutes
  let templateId = body.template_id || null

  if (templateId) {
    const { data: tpl } = await db.from('shift_templates').select('*').eq('id', templateId).maybeSingle()
    if (!tpl) throw apiError(404, 'Shift template not found')
    startTime = startTime || tpl.start_time.slice(0, 5)
    endTime = endTime || tpl.end_time.slice(0, 5)
    breakMinutes = breakMinutes ?? tpl.break_minutes
  }
  assertTime(startTime, 'start_time')
  assertTime(endTime, 'end_time')

  const { data, error } = await db.from('shifts').insert({
    workspace_id: ctx.workspaceId,
    roster_id: roster.id,
    store_id: roster.store_id,
    staff_id: body.staff_id || null,
    work_date: workDate,
    start_at: sgTimestamp(workDate, startTime),
    end_at: sgTimestamp(workDate, endTime),
    break_minutes: Math.max(0, Number(breakMinutes) || 0),
    job_code: body.job_code || null,
    template_id: templateId,
    notes: body.notes || null,
  }).select().single()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'shifts', entity_id: data.id, operation: 'INSERT', after_data: data,
    // roster_id/store_id let the change history be pulled per week (incl. once
    // this shift is deleted); reason is the "why" a dispute later asks for.
    metadata: { roster_id: roster.id, store_id: roster.store_id, reason: body.reason || null },
  })
  return { data }
})
