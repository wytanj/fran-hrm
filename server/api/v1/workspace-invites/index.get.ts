// Pending invites for this workspace (admin view).
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const db = getAdminClient()
  const { data, error } = await db.from('workspace_invites')
    .select('id, email, role, token, expires_at, created_at, inviter:invited_by(display_name)')
    .eq('workspace_id', ctx.workspaceId).is('accepted_at', null)
    .order('created_at', { ascending: false })
  if (error) throw apiError(500, error.message)
  const now = Date.now()
  return {
    data: (data || []).map((i: any) => ({
      id: i.id, email: i.email, role: i.role, token: i.token,
      expires_at: i.expires_at, expired: new Date(i.expires_at).getTime() < now,
      invited_by: i.inviter?.display_name || null,
    })),
  }
})
