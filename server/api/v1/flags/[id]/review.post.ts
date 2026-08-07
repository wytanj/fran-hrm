import { recordAudit } from '../../../../../core/audit/record.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'attendance:write' })
  const db = getAdminClient()
  const { data: flag } = await db
    .from('attendance_flags').select('*').eq('workspace_id', ctx.workspaceId).eq('id', getRouterParam(event, 'id')).maybeSingle()
  if (!flag) throw apiError(404, 'Flag not found')

  const { data, error } = await db.from('attendance_flags').update({
    status: 'reviewed',
    reviewed_by: ctx.kind === 'session' ? ctx.staff.id : null,
    reviewed_at: new Date().toISOString(),
  }).eq('id', flag.id).select().single()
  if (error) throw apiError(500, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'attendance_flags', entity_id: flag.id, operation: 'ACTION',
    metadata: { action: 'review_flag', flag_type: flag.flag_type },
  })
  return { data }
})
