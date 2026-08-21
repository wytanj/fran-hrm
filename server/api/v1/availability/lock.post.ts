import { recordAudit } from '../../../../core/audit/record.mjs'
import { listAvailabilityLocks } from '../../../../core/roster/query.mjs'
import { assertDate } from '../../../utils/dates'

// Manager lock/unlock of a staff member's availability for specific dates.
// Independent of the automatic cutoff. Only roster:write may call this —
// staff cannot lock their own dates.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const staffId = String(body?.staff_id || '').trim()
  if (!staffId) throw apiError(400, 'staff_id is required')
  if (typeof body?.locked !== 'boolean') throw apiError(400, 'locked must be true or false')

  const rawDates = Array.isArray(body?.dates) ? body.dates : []
  const dates = [...new Set(rawDates.map((d: unknown) => assertDate(d, 'dates')))]
  if (!dates.length) throw apiError(400, 'dates[] is required')

  const { data: target } = await db.from('staff').select('id')
    .eq('workspace_id', ctx.workspaceId).eq('id', staffId).maybeSingle()
  if (!target) throw apiError(404, 'Staff not found in this workspace')

  if (body.locked) {
    const lockedBy = ctx.kind === 'session' ? ctx.staff.id : null
    const lockedAt = new Date().toISOString()
    const rows = dates.map((workDate) => ({
      workspace_id: ctx.workspaceId,
      staff_id: staffId,
      work_date: workDate,
      locked_by: lockedBy,
      locked_at: lockedAt,
    }))
    const { error } = await db
      .from('availability_locks')
      .upsert(rows, { onConflict: 'staff_id,work_date' })
    if (error) throw apiError(400, error.message)
  } else {
    const { error } = await db
      .from('availability_locks')
      .delete()
      .eq('workspace_id', ctx.workspaceId)
      .eq('staff_id', staffId)
      .in('work_date', dates)
    if (error) throw apiError(400, error.message)
  }

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'availability_lock', entity_id: staffId,
    operation: body.locked ? 'LOCK' : 'UNLOCK',
    after_data: { dates },
  })

  if (!body.locked) return { data: [], ok: true }

  const from = dates.reduce((a, b) => (a < b ? a : b))
  const to = dates.reduce((a, b) => (a > b ? a : b))
  const wanted = new Set(dates)
  const locks = await listAvailabilityLocks(db, ctx.workspaceId, { staff_id: staffId, from, to })
  return { data: locks.filter((r) => wanted.has(r.work_date)), ok: true }
})
