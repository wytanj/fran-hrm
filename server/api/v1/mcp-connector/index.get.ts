import { describeMcpOauthClient, listMcpOauthConnections, mcpOauthIssuer, mcpScopesForRole } from '../../../utils/mcpOauth'
// @ts-ignore .mjs shared module
import { resolvePermittedTools } from '../../../../mcp/src/toolScopes.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'connector:manage' })
  const db = getAdminClient()
  const issuer = mcpOauthIssuer(event)

  const [client, connections] = await Promise.all([
    describeMcpOauthClient(db, ctx.workspaceId),
    listMcpOauthConnections(db, ctx.workspaceId),
  ])

  const { data: invites } = await db
    .from('mcp_connect_invites')
    .select('token, note, expires_at, used_at, staff:staff_id(employee_code, display_name)')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(20)

  // What each role would get through Claude, read from the live permission
  // matrix — so this page reflects a permissions edit immediately.
  const roleMatrix = await Promise.all(
    ['staff', 'supervisor', 'store_manager', 'area_manager', 'finance', 'hq_admin'].map(async (role) => {
      const scopes = await mcpScopesForRole(db, ctx.workspaceId, role)
      return { role, tool_count: resolvePermittedTools(scopes).length, scopes }
    }),
  )

  return {
    data: {
      client,
      connector_url: `${issuer}/mcp`,
      connections,
      invites: (invites || []).map((i: any) => ({
        url: `${issuer}/oauth/connect?invite=${i.token}`,
        note: i.note,
        expires_at: i.expires_at,
        used_at: i.used_at,
        staff: i.staff ? `${i.staff.display_name} (${i.staff.employee_code})` : 'anyone',
      })),
      role_matrix: roleMatrix,
    },
  }
})
