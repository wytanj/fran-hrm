import { recordAudit } from '../../../../../core/audit/record.mjs'
import { sgTimestamp } from '../../../../utils/dates'
import { assertNotLocked } from '../../../../utils/payrollLock'

// Supervisor/SM decides a correction. Approval applies the change to the
// time entry (creating it for add_entry), appends a correction clock event,
// and audits before/after — the original value is never destroyed.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'attendance:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const decision = String(body?.decision || '')
  if (!['approved', 'rejected'].includes(decision)) {
    throw apiError(400, 'decision must be approved | rejected')
  }

  const { data: corr } = await db
    .from('time_corrections').select('*').eq('workspace_id', ctx.workspaceId).eq('id', getRouterParam(event, 'id')).maybeSingle()
  if (!corr) throw apiError(404, 'Correction not found')
  if (corr.status !== 'pending') throw apiError(409, `Correction is already ${corr.status}`)

  let before: any = null
  let after: any = null

  if (decision === 'approved') {
    await assertNotLocked(ctx.workspaceId, corr.work_date)

    if (corr.field === 'add_entry') {
      // new_value format: "HH:MM-HH:MM[,break_minutes]"
      const m = String(corr.new_value).match(/^(\d{2}:\d{2})-(\d{2}:\d{2})(?:,(\d+))?$/)
      if (!m) throw apiError(422, 'add_entry new_value must be "HH:MM-HH:MM[,break_minutes]"')
      const { data, error } = await db.from('time_entries').insert({
        workspace_id: ctx.workspaceId,
        store_id: corr.store_id,
        staff_id: corr.staff_id,
        work_date: corr.work_date,
        clock_in_at: sgTimestamp(corr.work_date, m[1]),
        clock_out_at: sgTimestamp(corr.work_date, m[2]),
        break_minutes: Number(m[3]) || 0,
        source: 'correction',
        status: 'closed',
      }).select().single()
      if (error) throw apiError(500, error.message)
      after = data
    } else {
      if (!corr.time_entry_id) throw apiError(422, 'Correction has no target time entry')
      const { data: entry } = await db.from('time_entries').select('*').eq('id', corr.time_entry_id).maybeSingle()
      if (!entry) throw apiError(404, 'Target time entry no longer exists')
      before = entry
      const value = corr.field === 'break_minutes' ? Number(corr.new_value) : new Date(corr.new_value).toISOString()
      const patch: Record<string, any> = { [corr.field]: value, updated_at: new Date().toISOString() }
      if (corr.field === 'clock_out_at' && entry.status === 'open') patch.status = 'closed'
      const { data, error } = await db.from('time_entries').update(patch).eq('id', entry.id).select().single()
      if (error) throw apiError(500, error.message)
      after = data

      if (corr.field !== 'break_minutes') {
        await db.from('clock_events').insert({
          workspace_id: ctx.workspaceId,
          store_id: entry.store_id,
          staff_id: entry.staff_id,
          type: corr.field === 'clock_in_at' ? 'clock_in' : 'clock_out',
          at: value,
          method: 'correction',
          recorded_by: ctx.kind === 'session' ? ctx.staff.id : null,
          note: `Correction ${corr.id} approved`,
        })
      }
    }
  }

  const { data, error } = await db.from('time_corrections').update({
    status: decision,
    decided_by: ctx.kind === 'session' ? ctx.staff.id : null,
    decided_at: new Date().toISOString(),
    decision_note: body.note || null,
  }).eq('id', corr.id).select().single()
  if (error) throw apiError(500, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'time_corrections', entity_id: corr.id, operation: 'ACTION',
    before_data: before ? { entry: before, status: 'pending' } : { status: 'pending' },
    after_data: after ? { entry: after, status: decision } : { status: decision },
    metadata: { action: 'decide_correction', field: corr.field, old_value: corr.old_value, new_value: corr.new_value },
  })
  return { data, applied: decision === 'approved' }
})
