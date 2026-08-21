import { listTemplates, upsertTemplate } from '../../../../core/roster/templates.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const id = getRouterParam(event, 'id')
  const body = await readBody(event) || {}
  const templates = await listTemplates(getAdminClient(), ctx.workspaceId, { includeInactive: true })
  const existing = templates.find((t: any) => t.id === id)
  if (!existing) throw apiError(404, `No shift template "${id}".`)
  try {
    const data = await upsertTemplate(getAdminClient(), ctx.workspaceId, { ...body, id: existing.id }, {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    })
    return { data }
  } catch (err: any) {
    throw apiError(400, err?.message || 'Could not update template')
  }
})
