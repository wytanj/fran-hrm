/**
 * Per-user OAuth 2.1 for the remote MCP endpoint (Claude connector).
 * Ported from fran-skums; identity is a FranHRM staff member (employee code +
 * PIN session) rather than a Supabase Auth user.
 *
 * The problem it solves: Claude stores ONE connector config per organisation.
 * With an API key in the URL, every employee shares one key and therefore one
 * set of permissions. OAuth fixes that because the shared part (client
 * id/secret) only identifies Claude-the-app; the credential that grants data
 * access is an access token minted per staff member after they sign in here.
 *
 * Scopes are re-derived from the staff member's CURRENT role on every request,
 * so a demotion or termination cuts their Claude access on the next message.
 *
 * @see server/utils/mcpOauthProtocol.ts (pure protocol rules)
 * @see core/db/005_mcp_oauth.sql, 006_mcp_oauth_clients.sql
 */
import { randomBytes } from 'node:crypto'
import type { H3Event } from 'h3'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getAdminClient } from './supabase'
// @ts-ignore .mjs shared module
import { resolveStaffScopes, scopesForRole } from '../../core/permissions/resolve.mjs'
import {
  ACCESS_TTL_MS,
  CLAUDE_REDIRECT_URIS,
  CODE_TTL_MS,
  MCP_ACCESS_TOKEN_PREFIX,
  MCP_CODE_PREFIX,
  MCP_OAUTH_SCOPES,
  MCP_REFRESH_TOKEN_PREFIX,
  OauthError,
  REFRESH_TTL_MS,
  type AuthorizeParams,
  authorizationServerMetadataFor,
  checkAuthorizeParams,
  generateClientCredentials,
  grantIncludesOfflineAccess,
  hashMcpToken,
  isMcpOauthAccessToken,
  protectedResourceMetadataFor,
  resourceMatches,
  unauthorizedHeaderFor,
  verifyClientSecretHash,
  verifyPkceS256,
} from './mcpOauthProtocol'

// Protocol helpers are NOT re-exported: Nitro auto-imports every util, and two
// modules exporting the same name makes which one wins arbitrary. Import them
// from ./mcpOauthProtocol directly.

export type McpOauthClient = {
  id: string | null
  clientId: string
  clientSecretHash: string | null
  redirectUris: string[]
  source: 'database' | 'env'
}

export type McpOauthTokenGrant = {
  accessToken: string
  refreshToken: string | null
  expiresInSeconds: number
  scope: string
}

/**
 * MCP scopes come from the SAME editable role matrix the web app uses, so
 * granting a supervisor roster:publish in Settings → Permissions changes what
 * they can do through Claude too. There is no second copy of the rules here.
 */
export async function mcpScopesForRole(
  db: SupabaseClient, workspaceId: string, role: string | null | undefined,
): Promise<string[]> {
  if (!role) return []
  return scopesForRole(db, workspaceId, role)
}

/** Registered redirect URIs. Env var is an escape hatch for local tunnels. */
function registeredRedirectUris(): string[] {
  const extra = String(process.env.MCP_OAUTH_EXTRA_REDIRECT_URIS || '')
    .split(',').map((s) => s.trim()).filter(Boolean)
  return [...CLAUDE_REDIRECT_URIS, ...extra]
}

/** Env-var fallback so local dev needs no DB row. */
function envMcpOauthClient(): McpOauthClient | null {
  const config = useRuntimeConfig()
  const clientId = String((config as any).mcpOauthClientId || process.env.MCP_OAUTH_CLIENT_ID || '').trim()
  if (!clientId) return null
  const clientSecret = String((config as any).mcpOauthClientSecret || process.env.MCP_OAUTH_CLIENT_SECRET || '').trim()
  return {
    id: null,
    clientId,
    clientSecretHash: clientSecret ? hashMcpToken(clientSecret) : null,
    redirectUris: registeredRedirectUris(),
    source: 'env',
  }
}

function rowToClient(row: any): McpOauthClient {
  return {
    id: row.id,
    clientId: row.client_id,
    clientSecretHash: row.client_secret_hash || null,
    redirectUris: registeredRedirectUris(),
    source: 'database',
  }
}

/**
 * Resolve the client a request claims to be, BY THE ID PRESENTED. Use this on
 * every path that authenticates — resolving by id rather than "the newest row"
 * is what lets two workspaces hold separate credentials on one endpoint.
 */
export async function mcpOauthClientById(
  clientId: string | null | undefined,
  db?: SupabaseClient,
): Promise<McpOauthClient | null> {
  const id = String(clientId || '').trim()
  if (!id) return null
  try {
    const { data } = await (db || getAdminClient())
      .from('mcp_oauth_clients').select('*').eq('client_id', id).is('revoked_at', null).maybeSingle()
    if (data) return rowToClient(data)
  } catch {
    // Missing table or unreachable DB — fall back rather than taking /mcp down.
  }
  const env = envMcpOauthClient()
  return env && env.clientId === id ? env : null
}

/**
 * Is OAuth switched on at all? ONLY for the two boolean gates (discovery 404,
 * /mcp 401) — it returns an arbitrary live client, so never authenticate with it.
 */
export async function anyMcpOauthClient(db?: SupabaseClient): Promise<McpOauthClient | null> {
  try {
    const { data } = await (db || getAdminClient())
      .from('mcp_oauth_clients').select('*').is('revoked_at', null)
      .order('created_at', { ascending: false }).limit(1)
    if (data?.length) return rowToClient(data[0])
  } catch { /* degrade to env, never throw */ }
  return envMcpOauthClient()
}

export function touchMcpOauthClient(db: SupabaseClient, client: McpOauthClient): void {
  if (!client.id) return
  db.from('mcp_oauth_clients').update({ last_used_at: new Date().toISOString() })
    .eq('id', client.id).then(() => {}, () => {})
}

/**
 * Create the client, or rotate the secret on the existing one. Rotation keeps
 * the client_id so the admin updates one field in Claude. Returns the raw
 * secret — the only time it exists outside this function.
 */
export async function createOrRotateMcpOauthClient(
  db: SupabaseClient,
  input: { workspaceId: string; staffId: string | null; label?: string | null },
): Promise<{ clientId: string; clientSecret: string; rotated: boolean }> {
  const generated = generateClientCredentials()
  const { data: existing } = await db
    .from('mcp_oauth_clients').select('id, client_id')
    .eq('workspace_id', input.workspaceId).is('revoked_at', null)
    .order('created_at', { ascending: false }).limit(1)

  const current = existing?.[0]
  if (current) {
    const { error } = await db.from('mcp_oauth_clients').update({
      client_secret_hash: hashMcpToken(generated.clientSecret),
      secret_prefix: generated.clientSecret.slice(0, 6),
      rotated_at: new Date().toISOString(),
      label: input.label ?? undefined,
    }).eq('id', current.id)
    if (error) throw new Error(`could not rotate client secret: ${error.message}`)
    return { clientId: current.client_id as string, clientSecret: generated.clientSecret, rotated: true }
  }

  const { error } = await db.from('mcp_oauth_clients').insert({
    workspace_id: input.workspaceId,
    client_id: generated.clientId,
    client_secret_hash: hashMcpToken(generated.clientSecret),
    secret_prefix: generated.clientSecret.slice(0, 6),
    label: input.label || 'Claude connector',
    created_by: input.staffId,
  })
  if (error) throw new Error(`could not create client: ${error.message}`)
  return { clientId: generated.clientId, clientSecret: generated.clientSecret, rotated: false }
}

/** Metadata for the admin screen. Never returns the secret or its hash. */
export async function describeMcpOauthClient(db: SupabaseClient, workspaceId: string) {
  const { data } = await db
    .from('mcp_oauth_clients')
    .select('client_id, secret_prefix, client_secret_hash, label, created_at, rotated_at, last_used_at')
    .eq('workspace_id', workspaceId).is('revoked_at', null)
    .order('created_at', { ascending: false }).limit(1)

  const row = data?.[0]
  if (row) {
    return {
      configured: true,
      source: 'database' as const,
      client_id: row.client_id as string,
      secret_prefix: (row.secret_prefix as string) || null,
      has_secret: Boolean(row.client_secret_hash),
      label: (row.label as string) || null,
      created_at: (row.created_at as string) || null,
      rotated_at: (row.rotated_at as string) || null,
      last_used_at: (row.last_used_at as string) || null,
    }
  }
  const env = envMcpOauthClient()
  return {
    configured: Boolean(env),
    source: env ? ('env' as const) : null,
    client_id: env?.clientId || null,
    secret_prefix: null,
    has_secret: Boolean(env?.clientSecretHash),
    label: env ? 'Environment variables' : null,
    created_at: null, rotated_at: null, last_used_at: null,
  }
}

/** Who currently has a live Claude connection. */
export async function listMcpOauthConnections(db: SupabaseClient, workspaceId: string) {
  const { data } = await db
    .from('mcp_oauth_tokens')
    .select('staff_id, created_at, last_used_at, expires_at, staff:staff_id(employee_code, display_name, role)')
    .eq('workspace_id', workspaceId).is('revoked_at', null)
    .order('created_at', { ascending: false }).limit(200)

  // One live connection per person, newest first (rotation revokes older rows).
  const byStaff = new Map<string, any>()
  for (const row of data || []) {
    if (!byStaff.has(row.staff_id as string)) byStaff.set(row.staff_id as string, row)
  }
  return [...byStaff.values()].map((row) => ({
    staff_id: row.staff_id,
    employee_code: row.staff?.employee_code || null,
    display_name: row.staff?.display_name || null,
    role: row.staff?.role || null,
    created_at: row.created_at,
    last_used_at: row.last_used_at,
    expires_at: row.expires_at,
  }))
}

export async function revokeMcpOauthTokensForStaff(
  db: SupabaseClient, workspaceId: string, staffId: string, reason = 'revoked_by_admin',
): Promise<number> {
  const { data } = await db.from('mcp_oauth_tokens')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: reason })
    .eq('workspace_id', workspaceId).eq('staff_id', staffId).is('revoked_at', null).select('id')
  return data?.length || 0
}

/** Absolute origin of this deployment, as Claude sees it. */
export function mcpOauthIssuer(event: H3Event): string {
  const explicit = String(process.env.MCP_OAUTH_ISSUER || '').trim()
  if (explicit) return explicit.replace(/\/+$/, '')
  const host = getHeader(event, 'x-forwarded-host') || getHeader(event, 'host') || ''
  const proto = String(getHeader(event, 'x-forwarded-proto') || (host.startsWith('localhost') ? 'http' : 'https')).split(',')[0]
  if (host) return `${proto}://${host}`.replace(/\/+$/, '')
  return 'https://fran-hrm.vercel.app'
}

/** The protected resource — must match the URL typed into Claude exactly. */
export function mcpResourceUrl(event: H3Event): string {
  return `${mcpOauthIssuer(event)}/mcp`
}

export function protectedResourceMetadata(event: H3Event) {
  return protectedResourceMetadataFor(mcpOauthIssuer(event))
}

export async function authorizationServerMetadata(event: H3Event) {
  const client = await anyMcpOauthClient()
  return authorizationServerMetadataFor(mcpOauthIssuer(event), Boolean(client?.clientSecretHash))
}

export function mcpUnauthorizedHeader(event: H3Event): string {
  return unauthorizedHeaderFor(mcpOauthIssuer(event))
}

/** H3 wrapper around checkAuthorizeParams — throws so handlers stay linear. */
export async function validateAuthorizeRequest(
  event: H3Event, query: Record<string, any>,
): Promise<AuthorizeParams> {
  const client = await mcpOauthClientById(query.client_id)
  if (!client) {
    const configured = await anyMcpOauthClient()
    throw configured
      ? apiError(400, 'Unknown client_id. Check the OAuth Client ID in the Claude connector settings.')
      : apiError(503, 'MCP OAuth is not configured on this deployment. An HQ admin must generate connector credentials in FranHRM → Connect Claude.')
  }
  const result = checkAuthorizeParams(query, {
    clientId: client.clientId,
    redirectUris: client.redirectUris,
    resource: mcpResourceUrl(event),
  })
  if (!result.ok) throw apiError(result.status, result.message)
  return result.params
}

/**
 * MCP scopes for an OAuth-authenticated staff member, derived from their LIVE
 * record. Fails closed: inactive/terminated staff resolve to [].
 */
export async function resolveMcpScopesForStaff(
  db: SupabaseClient, workspaceId: string, staffId: string,
): Promise<{ scopes: string[]; role: string | null; deniedReason?: string; overrides?: any[] }> {
  const { data: staff } = await db
    .from('staff').select('id, role, employment_status, workspace_id')
    .eq('id', staffId).maybeSingle()

  if (!staff) return { scopes: [], role: null, deniedReason: 'staff_record_not_found' }
  if (staff.workspace_id !== workspaceId) return { scopes: [], role: null, deniedReason: 'staff_not_in_workspace' }
  if (staff.employment_status !== 'active') {
    return { scopes: [], role: staff.role, deniedReason: `employment_status_${staff.employment_status}` }
  }
  // Same resolver as the web app: role matrix + this person's own grants.
  const { scopes, overrides } = await resolveStaffScopes(db, workspaceId, staff)
  if (!scopes.length) return { scopes: [], role: staff.role, deniedReason: 'role_has_no_permissions' }
  return { scopes, role: staff.role, overrides }
}

export async function mintAuthorizationCode(
  db: SupabaseClient,
  input: {
    workspaceId: string; staffId: string; clientId: string; redirectUri: string
    codeChallenge: string; resource: string | null; scope: string
  },
): Promise<string> {
  const raw = `${MCP_CODE_PREFIX}${randomBytes(32).toString('base64url')}`
  const { error } = await db.from('mcp_oauth_codes').insert({
    code_hash: hashMcpToken(raw),
    workspace_id: input.workspaceId,
    staff_id: input.staffId,
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code_challenge: input.codeChallenge,
    code_challenge_method: 'S256',
    resource: input.resource,
    scope: input.scope,
    expires_at: new Date(Date.now() + CODE_TTL_MS).toISOString(),
  })
  if (error) throw new OauthError('server_error', `could not persist code: ${error.message}`, 500)
  return raw
}

async function issueTokens(
  db: SupabaseClient,
  input: {
    workspaceId: string; staffId: string; clientId: string; resource: string | null
    scope: string; withRefresh: boolean; rotatedFrom?: string | null
  },
): Promise<McpOauthTokenGrant> {
  const accessToken = `${MCP_ACCESS_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
  const refreshToken = input.withRefresh
    ? `${MCP_REFRESH_TOKEN_PREFIX}${randomBytes(32).toString('base64url')}`
    : null

  const { error } = await db.from('mcp_oauth_tokens').insert({
    access_token_hash: hashMcpToken(accessToken),
    refresh_token_hash: refreshToken ? hashMcpToken(refreshToken) : null,
    workspace_id: input.workspaceId,
    staff_id: input.staffId,
    client_id: input.clientId,
    resource: input.resource,
    scope: input.scope,
    expires_at: new Date(Date.now() + ACCESS_TTL_MS).toISOString(),
    refresh_expires_at: refreshToken ? new Date(Date.now() + REFRESH_TTL_MS).toISOString() : null,
    rotated_from: input.rotatedFrom || null,
  })
  if (error) throw new OauthError('server_error', `could not persist token: ${error.message}`, 500)

  return {
    accessToken,
    refreshToken,
    expiresInSeconds: Math.floor(ACCESS_TTL_MS / 1000),
    scope: input.scope,
  }
}

export async function exchangeAuthorizationCode(
  db: SupabaseClient,
  input: { code: string; clientId: string; redirectUri: string; codeVerifier: string; resource: string | null },
): Promise<McpOauthTokenGrant> {
  const { data: row } = await db
    .from('mcp_oauth_codes').select('*').eq('code_hash', hashMcpToken(input.code)).maybeSingle()
  if (!row) throw new OauthError('invalid_grant', 'authorization code not recognised')

  // Single use (RFC 6749 §4.1.2). A replay means the code leaked, so burn the
  // staff member's whole grant rather than just refusing this request.
  if (row.consumed_at) {
    await db.from('mcp_oauth_tokens')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: 'authorization_code_replayed' })
      .eq('staff_id', row.staff_id).eq('workspace_id', row.workspace_id).is('revoked_at', null)
    throw new OauthError('invalid_grant', 'authorization code already used')
  }
  if (new Date(row.expires_at) < new Date()) throw new OauthError('invalid_grant', 'authorization code expired')
  if (row.client_id !== input.clientId) throw new OauthError('invalid_grant', 'authorization code was issued to another client')
  if (row.redirect_uri !== input.redirectUri) throw new OauthError('invalid_grant', 'redirect_uri does not match the authorization request')
  if (row.code_challenge_method !== 'S256') throw new OauthError('invalid_grant', 'unsupported code_challenge_method')
  if (!verifyPkceS256(input.codeVerifier, row.code_challenge)) throw new OauthError('invalid_grant', 'PKCE verification failed')
  if (!resourceMatches(input.resource, row.resource || '')) throw new OauthError('invalid_target', 'resource does not match the authorization request')

  // Mark consumed before minting so a concurrent replay loses the race.
  const { data: consumed } = await db.from('mcp_oauth_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id).is('consumed_at', null).select('id').maybeSingle()
  if (!consumed) throw new OauthError('invalid_grant', 'authorization code already used')

  // Opportunistic cleanup — cheap, saves a scheduled job.
  db.from('mcp_oauth_codes').delete()
    .lt('expires_at', new Date(Date.now() - 86400_000).toISOString()).then(() => {}, () => {})

  const scope = String(row.scope || 'mcp')
  return issueTokens(db, {
    workspaceId: row.workspace_id,
    staffId: row.staff_id,
    clientId: row.client_id,
    resource: row.resource,
    scope,
    withRefresh: grantIncludesOfflineAccess(scope),
  })
}

export async function refreshAccessToken(
  db: SupabaseClient,
  input: { refreshToken: string; clientId: string; resource: string | null },
): Promise<McpOauthTokenGrant> {
  const { data: row } = await db
    .from('mcp_oauth_tokens').select('*')
    .eq('refresh_token_hash', hashMcpToken(input.refreshToken)).maybeSingle()

  // RFC 6749 requires invalid_grant for a dead refresh token — Claude keys its
  // "re-run the consent flow" behaviour off that code.
  if (!row) throw new OauthError('invalid_grant', 'refresh token not recognised')
  if (row.revoked_at) throw new OauthError('invalid_grant', 'refresh token revoked')
  if (row.client_id !== input.clientId) throw new OauthError('invalid_grant', 'refresh token was issued to another client')
  if (row.refresh_expires_at && new Date(row.refresh_expires_at) < new Date()) {
    throw new OauthError('invalid_grant', 'refresh token expired')
  }

  // Re-check employment here too, so an offboarded staff member's connection
  // dies at the next refresh even if nothing calls a tool.
  const check = await resolveMcpScopesForStaff(db, row.workspace_id, row.staff_id)
  if (!check.scopes.length) {
    await db.from('mcp_oauth_tokens')
      .update({ revoked_at: new Date().toISOString(), revoked_reason: check.deniedReason || 'no_scopes' })
      .eq('id', row.id)
    throw new OauthError('invalid_grant', 'staff member no longer has access')
  }

  // Rotate: the old row dies in the same step that issues its replacement.
  await db.from('mcp_oauth_tokens')
    .update({ revoked_at: new Date().toISOString(), revoked_reason: 'rotated' }).eq('id', row.id)

  return issueTokens(db, {
    workspaceId: row.workspace_id,
    staffId: row.staff_id,
    clientId: row.client_id,
    resource: row.resource,
    scope: String(row.scope || 'mcp'),
    withRefresh: true,
    rotatedFrom: row.id,
  })
}

export type McpOauthIdentity = {
  tokenId: string
  workspaceId: string
  staffId: string
  clientId: string
  scope: string | null
}

/** Look up a bearer access token. Null when it is not one of ours, so the
 * caller can fall through to API-key auth. */
export async function authenticateMcpOauthToken(
  db: SupabaseClient, rawToken: string,
): Promise<McpOauthIdentity | null> {
  if (!isMcpOauthAccessToken(rawToken)) return null
  const { data: row } = await db
    .from('mcp_oauth_tokens')
    .select('id, workspace_id, staff_id, client_id, scope, expires_at, revoked_at')
    .eq('access_token_hash', hashMcpToken(rawToken)).maybeSingle()

  if (!row || row.revoked_at) return null
  if (new Date(row.expires_at) < new Date()) return null

  db.from('mcp_oauth_tokens').update({ last_used_at: new Date().toISOString() })
    .eq('id', row.id).then(() => {}, () => {})

  return {
    tokenId: row.id as string,
    workspaceId: row.workspace_id as string,
    staffId: row.staff_id as string,
    clientId: row.client_id as string,
    scope: (row.scope as string) || null,
  }
}
