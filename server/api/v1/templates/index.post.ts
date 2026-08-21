import { upsertTemplate } from '../../../../core/roster/templates.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const body = await readBody(event) || {}
  const { id: _ignored, ...input } = body
  try {
    const data = await upsertTemplate(getAdminClient(), ctx.workspaceId, input, {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    })
    return { data }
  } catch (err: any) {
    throw apiError(400, err?.message || 'Could not save template')
  }
})
