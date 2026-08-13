import { upsertCustomField } from '../../../../../core/staff/profile.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const body = await readBody(event) || {}
  try {
    const data = await upsertCustomField(getAdminClient(), ctx.workspaceId, body, {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    })
    return { data }
  } catch (err: any) {
    throw apiError(400, err?.message || 'Could not save field')
  }
})
