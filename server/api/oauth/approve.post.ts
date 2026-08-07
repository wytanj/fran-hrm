/**
 * Mints an authorization code for the signed-in staff member and returns the
 * redirect back to Claude.
 *
 * The identity binding the whole design rests on happens here: the code is
 * tied to the FranHRM session cookie — the person holding this browser — never
 * to the workspace or the connector. There is no path through this handler
 * that issues a code without a live staff session, which is what stops
 * "anyone in the org who clicks Connect gets the same power".
 */
import { recordAudit } from '../../../core/audit/record.mjs'
import { mintAuthorizationCode, resolveMcpScopesForStaff, validateAuthorizeRequest } from '../../utils/mcpOauth'

export default defineEventHandler(async (event) => {
  const body = (await readBody(event).catch(() => ({}))) as Record<string, any>
  const request = await validateAuthorizeRequest(event, body)

  const staff = await getSessionStaff(event)
  if (!staff) throw apiError(401, 'Sign in to FranHRM before authorizing.')

  const db = getAdminClient()
  // Re-check rather than trusting what the consent screen displayed.
  const { scopes, role } = await resolveMcpScopesForStaff(db, staff.workspace_id, staff.id)
  if (!scopes.length) {
    throw apiError(403, 'Your role has no MCP-compatible permissions.')
  }

  const code = await mintAuthorizationCode(db, {
    workspaceId: staff.workspace_id,
    staffId: staff.id,
    clientId: request.clientId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    resource: request.resource,
    scope: request.scope,
  })

  if (body.invite) {
    await db.from('mcp_connect_invites')
      .update({ used_at: new Date().toISOString(), used_by: staff.id })
      .eq('token', String(body.invite)).is('used_at', null)
  }

  await recordAudit(db, {
    workspace_id: staff.workspace_id,
    actor_kind: 'user',
    actor_id: staff.id,
    actor_name: staff.display_name,
    source_type: 'web',
    object_type: 'mcp_oauth_codes',
    operation: 'ACTION',
    metadata: { action: 'authorize_claude_connector', role, scopes, client_id: request.clientId },
  })

  const target = new URL(request.redirectUri)
  target.searchParams.set('code', code)
  if (request.state) target.searchParams.set('state', request.state)
  return { redirect_url: target.toString() }
})
