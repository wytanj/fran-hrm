/**
 * Backs the consent screen: who am I about to bind, and how much power does
 * that account carry? Without this, someone signed in as the wrong staff
 * account authorises silently and later reports "Claude can't see my roster".
 */
import { validateAuthorizeRequest, resolveMcpScopesForStaff, mcpResourceUrl } from '../../utils/mcpOauth'
// @ts-ignore .mjs shared module
import { resolvePermittedTools } from '../../../mcp/src/toolScopes.mjs'

export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  // Validate first: a bad client_id/redirect_uri should surface as an error on
  // the consent screen, not as a mysterious empty state.
  await validateAuthorizeRequest(event, query as Record<string, any>)

  const staff = await getSessionStaff(event)
  if (!staff) return { signed_in: false }

  const db = getAdminClient()
  const { data: store } = staff.home_store_id
    ? await db.from('stores').select('code, name').eq('id', staff.home_store_id).maybeSingle()
    : { data: null }
  const { data: workspace } = await db.from('workspaces').select('name').eq('id', staff.workspace_id).maybeSingle()

  const { scopes, role, deniedReason } = await resolveMcpScopesForStaff(db, staff.workspace_id, staff.id)
  const tools = resolvePermittedTools(scopes)

  // Honour an invite token if the link carried one — it does not grant power
  // (scopes come from the role), it just records that an admin invited them.
  let invite: any = null
  if (query.invite) {
    const { data } = await db.from('mcp_connect_invites')
      .select('id, staff_id, note, expires_at, used_at')
      .eq('token', String(query.invite)).eq('workspace_id', staff.workspace_id).maybeSingle()
    if (data && !data.used_at && new Date(data.expires_at) > new Date()) {
      invite = { note: data.note, for_me: !data.staff_id || data.staff_id === staff.id }
    }
  }

  return {
    signed_in: true,
    staff: {
      employee_code: staff.employee_code,
      display_name: staff.display_name,
      role,
      store: store?.name || null,
    },
    workspace_name: workspace?.name || null,
    scopes,
    tool_count: tools.length,
    tool_names: tools.map((t: any) => t.name),
    privileged_tools: tools.filter((t: any) => t.privileged).map((t: any) => t.name),
    can_authorize: scopes.length > 0,
    reason: deniedReason
      ? `This account cannot connect Claude: ${deniedReason.replace(/_/g, ' ')}.`
      : null,
    invite,
    resource: mcpResourceUrl(event),
  }
})
