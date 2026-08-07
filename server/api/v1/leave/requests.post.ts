import { leaveDaysBetween } from '../../../../core/leave/query.mjs'
import { recordAudit } from '../../../../core/audit/record.mjs'
import { assertDate } from '../../../utils/dates'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'leave:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const staffId = ctx.kind === 'session' ? ctx.staff.id : body.staff_id
  if (!staffId) throw apiError(400, 'staff_id is required for API-key callers')
  const startDate = assertDate(body?.start_date, 'start_date')
  const endDate = assertDate(body?.end_date || body?.start_date, 'end_date')

  const { data: leaveType } = await db
    .from('leave_types').select('*').eq('workspace_id', ctx.workspaceId).eq('id', body?.leave_type_id).maybeSingle()
  if (!leaveType) throw apiError(404, 'Leave type not found')

  const days = leaveDaysBetween(startDate, endDate, !!body.half_day)

  // Balance check is advisory for unpaid leave, hard for entitled types.
  if (Number(leaveType.default_days_per_year) > 0) {
    const year = Number(startDate.slice(0, 4))
    const { data: balance } = await db
      .from('leave_balances').select('*')
      .eq('staff_id', staffId).eq('leave_type_id', leaveType.id).eq('year', year).maybeSingle()
    const remaining = balance ? Number(balance.entitled_days) - Number(balance.used_days) : 0
    if (days > remaining) {
      throw apiError(422, `Insufficient ${leaveType.code} balance: requested ${days} day(s), ${remaining} remaining for ${year}`)
    }
  }

  const { data, error } = await db.from('leave_requests').insert({
    workspace_id: ctx.workspaceId,
    staff_id: staffId,
    leave_type_id: leaveType.id,
    start_date: startDate,
    end_date: endDate,
    days,
    half_day: !!body.half_day,
    reason: body.reason || null,
  }).select().single()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'leave_requests', entity_id: data.id, operation: 'INSERT', after_data: data,
  })
  return { data }
})
