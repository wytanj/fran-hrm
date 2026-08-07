// Remote MCP auth bridge: OAuth bearer (per-staff) or API key (headless) →
// per-request MCP context. The tool layer reads identity from
// AsyncLocalStorage, so the same code serves stdio and HTTP callers.
//
// OAuth is checked first and its scopes are re-derived from the staff member's
// LIVE role on every request — that is what makes a demotion or termination
// take effect on the next Claude message rather than at token expiry.
import { authenticateApiKey } from './apiAuth'
import { getAdminClient } from './supabase'
import { authenticateMcpOauthToken, resolveMcpScopesForStaff } from './mcpOauth'
import { isMcpOauthAccessToken } from './mcpOauthProtocol'
// @ts-ignore .mjs shared module
import { runWithMcpRequestContext, MCP_SCOPE_PROFILES } from '../../mcp/src/context.mjs'
// @ts-ignore .mjs shared module
import { handleMcpJsonRpc } from '../../mcp/src/httpProtocol.mjs'

export interface RemoteMcpAuth {
  workspaceId: string
  scopes: string[]
  clientName: string
  authKind: 'oauth' | 'api_key'
  staffId: string | null
  staffName: string | null
  role: string | null
  keyId: string | null
}

/** Bearer token from the header or the URL-injected context (for /mcp/c/:key). */
function readBearer(event: any): string | null {
  if (event.context.mcpApiKey) return String(event.context.mcpApiKey)
  const auth = getHeader(event, 'authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  const q = getQuery(event)
  for (const name of ['api_key', 'key', 'access_token', 'token']) {
    if (typeof q[name] === 'string' && q[name]) return String(q[name]).trim()
  }
  return null
}

export async function authenticateRemoteMcp(event: any): Promise<RemoteMcpAuth> {
  const bearer = readBearer(event)

  if (isMcpOauthAccessToken(bearer)) {
    const db = getAdminClient()
    const identity = await authenticateMcpOauthToken(db, bearer as string)
    if (!identity) {
      throw apiError(401, 'Your Claude connection has expired or been revoked. Reconnect from Claude to sign in to FranHRM again.')
    }
    // Live role → scopes, every request.
    const { scopes, role, deniedReason } = await resolveMcpScopesForStaff(db, identity.workspaceId, identity.staffId)
    if (!scopes.length) {
      throw apiError(403, `Your FranHRM account can no longer use Claude (${deniedReason || 'no permissions'}). Ask an HQ admin if this is unexpected.`)
    }
    const { data: staff } = await db.from('staff').select('display_name').eq('id', identity.staffId).maybeSingle()
    return {
      workspaceId: identity.workspaceId,
      scopes,
      clientName: `claude (${staff?.display_name || identity.staffId})`,
      authKind: 'oauth',
      staffId: identity.staffId,
      staffName: staff?.display_name || null,
      role,
      keyId: null,
    }
  }

  const ctx = await authenticateApiKey(event)
  if (!ctx) {
    throw apiError(401, 'FranHRM MCP needs authentication. Connect from Claude to sign in with your employee code + PIN (recommended — you get tools scoped to your own role), or use an API key via Authorization: Bearer sk_live_…')
  }
  // Filter to the MCP-relevant subset so a pos_connector key can't call HR tools.
  const mcpRelevant = new Set<string>(MCP_SCOPE_PROFILES.full)
  const scopes = ctx.scopes.filter((s: string) => mcpRelevant.has(s))
  return {
    workspaceId: ctx.workspaceId,
    scopes,
    clientName: ctx.keyName,
    authKind: 'api_key',
    staffId: null,
    staffName: null,
    role: null,
    keyId: ctx.keyId,
  }
}

export async function runRemoteMcpJsonRpc(auth: RemoteMcpAuth, body: unknown) {
  return runWithMcpRequestContext(
    {
      workspaceId: auth.workspaceId,
      scopes: auth.scopes,
      clientName: auth.clientName,
      actorStaffId: auth.staffId,
      actorName: auth.staffName,
      role: auth.role,
      cloud: true,
    },
    () => handleMcpJsonRpc(body, { cloud: true }),
  )
}

export { handleMcpJsonRpc }
