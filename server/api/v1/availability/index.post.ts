import { recordAudit } from '../../../../core/audit/record.mjs'
import { assertDate, sgToday, addDays } from '../../../utils/dates'

// Staff submit availability/preferences for future dates. Replaces existing
// entries per submitted date. A cutoff (availability_cutoff_days, default 7)
// stops staff editing days that are too close for the SM to re-plan;
// supervisors and above may override.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const body = await readBody(event)
  const db = getAdminClient()

  const entries = Array.isArray(body?.entries) ? body.entries : []
  if (!entries.length) throw apiError(400, 'entries[] is required')

  let staffId = ctx.kind === 'session' ? ctx.staff.id : body.staff_id
  if (body.staff_id && ctx.has('roster:write')) staffId = body.staff_id
  if (!staffId) throw apiError(400, 'staff_id is required for API-key callers')

  const settings = await getWorkspaceSettings(ctx.workspaceId)
  const cutoffDays = Number(settings.availability_cutoff_days) || 7
  const cutoffDate = addDays(sgToday(), cutoffDays)
  // Holding roster:write means you plan for others, so the cutoff is yours to override.
  const isManager = ctx.has('roster:write')

  const dates: string[] = []
  const rows = entries.map((e: any) => {
    const workDate = assertDate(e.work_date, 'work_date')
    if (!isManager && workDate < cutoffDate) {
      throw apiError(422, `Availability for ${workDate} is past the cutoff (${cutoffDays} days ahead). Ask your manager to adjust the roster directly.`)
    }
    if (!['available', 'preferred', 'unavailable'].includes(e.kind)) {
      throw apiError(400, 'kind must be available | preferred | unavailable')
    }
    dates.push(workDate)
    return {
      workspace_id: ctx.workspaceId,
      staff_id: staffId,
      work_date: workDate,
      kind: e.kind,
      start_time: e.start_time || null,
      end_time: e.end_time || null,
      note: e.note || null,
    }
  })

  await db.from('availability').delete().eq('staff_id', staffId).in('work_date', dates)
  const { data, error } = await db.from('availability').insert(rows).select()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'availability', entity_id: staffId, operation: 'UPDATE',
    after_data: { dates, count: rows.length },
  })
  return { data, ok: true }
})
