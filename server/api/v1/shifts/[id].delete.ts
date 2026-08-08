import { recordAudit } from '../../../../core/audit/record.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const db = getAdminClient()
  // Optional { reason } body — the "why" a dispute later asks for.
  const body = await readBody(event).catch(() => ({}))
  const { data: before } = await db
    .from('shifts').select('*').eq('workspace_id', ctx.workspaceId).eq('id', getRouterParam(event, 'id')).maybeSingle()
  if (!before) throw apiError(404, 'Shift not found')

  const { error } = await db.from('shifts').delete().eq('id', before.id)
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'shifts', entity_id: before.id, operation: 'DELETE', before_data: before,
    metadata: { roster_id: before.roster_id, store_id: before.store_id, reason: body?.reason || null },
  })
  return { ok: true }
})
