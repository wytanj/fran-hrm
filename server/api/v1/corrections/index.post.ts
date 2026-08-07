import { recordAudit } from '../../../../core/audit/record.mjs'
import { assertDate } from '../../../utils/dates'
import { assertNotLocked } from '../../../utils/payrollLock'

// Staff flags a missed/wrong clock (weekly correction workflow). The original
// value is preserved on the request AND in the audit trail; nothing changes
// until a supervisor/SM approves.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'attendance:read' })
  const body = await readBody(event)
  const db = getAdminClient()

  const staffId = ctx.kind === 'session' ? ctx.staff.id : body.staff_id
  if (!staffId) throw apiError(400, 'staff_id is required for API-key callers')
  const workDate = assertDate(body?.work_date, 'work_date')
  await assertNotLocked(ctx.workspaceId, workDate)

  const field = String(body?.field || '')
  if (!['clock_in_at', 'clock_out_at', 'break_minutes', 'add_entry'].includes(field)) {
    throw apiError(400, 'field must be clock_in_at | clock_out_at | break_minutes | add_entry')
  }
  if (!body?.new_value) throw apiError(400, 'new_value is required')

  let entry: any = null
  if (body.time_entry_id) {
    const { data } = await db.from('time_entries').select('*')
      .eq('workspace_id', ctx.workspaceId).eq('id', body.time_entry_id).maybeSingle()
    entry = data
    if (!entry) throw apiError(404, 'Time entry not found')
    if (ctx.kind === 'session' && entry.staff_id !== ctx.staff.id && ctx.role === 'staff') {
      throw apiError(403, 'You can only request corrections on your own entries')
    }
  }

  const { data, error } = await db.from('time_corrections').insert({
    workspace_id: ctx.workspaceId,
    time_entry_id: entry?.id || null,
    staff_id: staffId,
    store_id: entry?.store_id || body.store_id || null,
    work_date: workDate,
    field,
    old_value: entry ? String(entry[field] ?? '') : null,
    new_value: String(body.new_value),
    reason: body.reason || null,
    requested_by: ctx.kind === 'session' ? ctx.staff.id : staffId,
  }).select().single()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'time_corrections', entity_id: data.id, operation: 'INSERT', after_data: data,
  })
  return { data }
})
