// Public invite lookup by token — powers the /invite/{token} landing page.
// No auth: the invitee hasn't signed in yet. The token is the secret; the
// actual join still requires signing in with Google as the invited email.
export default defineEventHandler(async (event) => {
  const db = getAdminClient()
  const token = String(getRouterParam(event, 'token'))
  const { data } = await db.from('workspace_invites')
    .select('email, role, expires_at, accepted_at, workspace:workspace_id(name)')
    .eq('token', token).maybeSingle()
  if (!data) return { data: { valid: false } }
  const expired = new Date(data.expires_at).getTime() < Date.now()
  return {
    data: {
      valid: !data.accepted_at && !expired,
      accepted: !!data.accepted_at,
      expired,
      email: data.email,
      role: data.role,
      workspace: (data as any).workspace?.name || null,
    },
  }
})
