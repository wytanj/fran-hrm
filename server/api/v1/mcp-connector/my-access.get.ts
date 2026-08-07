// What Claude would get if I connected right now. Any signed-in staff member
// may ask about their own access.
import { resolveMcpScopesForStaff } from '../../../utils/mcpOauth'
// @ts-ignore .mjs shared module
import { resolvePermittedTools } from '../../../../mcp/src/toolScopes.mjs'

export default defineEventHandler(async (event) => {
  const staff = await getSessionStaff(event)
  if (!staff) throw apiError(401, 'Sign in required')

  const db = getAdminClient()
  const { scopes, role, deniedReason } = await resolveMcpScopesForStaff(db, staff.workspace_id, staff.id)
  const tools = resolvePermittedTools(scopes)

  const { data: token } = await db
    .from('mcp_oauth_tokens')
    .select('created_at, last_used_at, expires_at')
    .eq('staff_id', staff.id).is('revoked_at', null)
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

  return {
    role,
    scopes,
    tool_count: tools.length,
    tool_names: tools.map((t: any) => t.name),
    can_connect: scopes.length > 0,
    reason: deniedReason || null,
    connected: Boolean(token),
    connection: token || null,
  }
})
