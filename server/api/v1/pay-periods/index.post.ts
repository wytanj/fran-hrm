import { recordAudit } from '../../../../core/audit/record.mjs'
import { assertDate } from '../../../utils/dates'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'payroll:lock' })
  const body = await readBody(event)
  const db = getAdminClient()
  const startDate = assertDate(body?.start_date, 'start_date')
  const endDate = assertDate(body?.end_date, 'end_date')

  const { data, error } = await db.from('pay_periods')
    .insert({ workspace_id: ctx.workspaceId, start_date: startDate, end_date: endDate })
    .select().single()
  if (error) {
    if (error.code === '23505') throw apiError(409, 'This pay period already exists')
    throw apiError(400, error.message)
  }
  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'pay_periods', entity_id: data.id, operation: 'INSERT', after_data: data,
  })
  return { data }
})
