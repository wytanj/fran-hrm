import { deleteCustomField } from '../../../../../core/staff/profile.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  try {
    return await deleteCustomField(getAdminClient(), ctx.workspaceId, getRouterParam(event, 'id'), {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    })
  } catch (err: any) {
    const msg = err?.message || 'Could not delete field'
    throw apiError(/No custom|Built-in/i.test(msg) ? 404 : 400, msg)
  }
})
