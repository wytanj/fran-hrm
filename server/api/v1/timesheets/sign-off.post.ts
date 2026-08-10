// Sign off (or reopen) a store's weekly timesheet. Supervisor+ acts on other
// people's timesheets, so attendance:write. Reopen needs a reason (logged).
import { recordAudit } from '../../../../core/audit/record.mjs'
// @ts-ignore .mjs shared module
import { signOffWeek, reopenWeek, mondayOf } from '../../../../core/attendance/signoff.mjs'
import { assertDate } from '../../../utils/dates'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'attendance:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const storeId = String(body?.store_id || '')
  if (!storeId) throw apiError(400, 'store_id is required')
  const weekStart = mondayOf(assertDate(body?.week_start, 'week_start'))
  const action = String(body?.action || 'sign_off')
  const actor = { staffId: ctx.kind === 'session' ? ctx.staff.id : null }

  const auditBase = {
    workspace_id: ctx.workspaceId,
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'timesheet_weeks',
  }

  if (action === 'reopen') {
    const reason = String(body?.reason || '').trim()
    if (!reason) throw apiError(422, 'A reason is required to reopen a signed-off week.')
    const row = await reopenWeek(db, ctx.workspaceId, { storeId, weekStart, actor })
    await recordAudit(db, {
      ...auditBase, entity_id: row.id, operation: 'ACTION',
      after_data: { status: 'open' },
      metadata: { action: 'reopen_timesheet_week', store_id: storeId, week_start: weekStart, reason },
    })
    return { data: row, note: `Week of ${weekStart} reopened for editing.` }
  }

  const row = await signOffWeek(db, ctx.workspaceId, { storeId, weekStart, actor })
  await recordAudit(db, {
    ...auditBase, entity_id: row.id, operation: 'ACTION',
    after_data: { status: 'signed_off' },
    metadata: { action: 'sign_off_timesheet_week', store_id: storeId, week_start: weekStart },
  })
  return { data: row, note: `Week of ${weekStart} signed off.` }
})
