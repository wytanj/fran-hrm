// Revoke a pending invite.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (!ctx.has('staff:write') && !ctx.has('staff:invite')) {
    throw denied('staff:invite', { scopes: ctx.scopes, role: ctx.role, kind: ctx.kind, name: ctx.actorName })
  }
  const db = getAdminClient()
  const { error } = await db.from('workspace_invites').delete()
    .eq('workspace_id', ctx.workspaceId).eq('id', getRouterParam(event, 'id')).is('accepted_at', null)
  if (error) throw apiError(400, error.message)
  return { ok: true }
})
