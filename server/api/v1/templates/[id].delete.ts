import { deactivateTemplate } from '../../../../core/roster/templates.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  try {
    return await deactivateTemplate(getAdminClient(), ctx.workspaceId, getRouterParam(event, 'id'), {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    })
  } catch (err: any) {
    const msg = err?.message || 'Could not retire template'
    throw apiError(/No shift template/i.test(msg) ? 404 : 400, msg)
  }
})
