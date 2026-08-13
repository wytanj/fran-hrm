// FranHRM MCP request context. Same pattern as fran-skums: identical tool
// code serves stdio (identity from env) and remote HTTP (identity injected
// per request via AsyncLocalStorage) — accessors check the request context
// first and fall back to process.env.
import { AsyncLocalStorage } from 'node:async_hooks'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

// No dotenv dependency: stdio runs outside Nuxt, so read repo-root .env
// ourselves (skips vars that are already set, strips quotes).
export function loadDotEnv() {
  try {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
    const text = readFileSync(join(root, '.env'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env is fine when env vars are set */ }
}

export const mcpRequestContext = new AsyncLocalStorage()

export async function runWithMcpRequestContext(ctx, fn) {
  return mcpRequestContext.run(ctx, fn)
}

function getReq() {
  return mcpRequestContext.getStore() || null
}

let db = null

export function getDb() {
  if (db) return db
  const url = (process.env.SUPABASE_URL || '').trim()
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SECRET_KEY must be set for the FranHRM MCP server')
  db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return db
}

export function getWorkspaceId() {
  const req = getReq()
  if (req?.workspaceId) return String(req.workspaceId).trim()
  return (process.env.FRAN_HRM_MCP_WORKSPACE_ID || process.env.MCP_WORKSPACE_ID || process.env.WORKSPACE_ID || '').trim()
}

export function requireWorkspaceId() {
  const ws = getWorkspaceId()
  if (!ws) {
    throw new Error('Workspace not configured. Remote callers: your API key is bound to a workspace automatically. stdio: set FRAN_HRM_MCP_WORKSPACE_ID in .env (the seed script prints it).')
  }
  return ws
}

export function isCloudMcpRequest() {
  return !!getReq()?.cloud
}

export function getMcpClientName() {
  const req = getReq()
  if (req?.clientName) return String(req.clientName)
  return (process.env.FRAN_HRM_MCP_CLIENT || 'unknown').trim()
}

/**
 * The staff member an OAuth-authenticated request acts as. Null for API-key
 * and stdio callers (agent-only attribution). Audit rows use this so
 * "who asked Claude to do this" is answerable.
 */
export function getMcpActorStaffId() {
  const req = getReq()
  if (req?.actorStaffId) return String(req.actorStaffId)
  return (process.env.FRAN_HRM_MCP_ACTOR_STAFF_ID || '').trim() || null
}

export function getMcpActorRole() {
  return getReq()?.role || null
}

/**
 * Roles at or above supervisor may read other people's records. An
 * OAuth-connected `staff` member may only read their own — the same rule the
 * REST API enforces via limitToSelf(). API-key and stdio callers have no
 * actor role and are trusted (their scopes are the gate), so they pass.
 */
const ROLE_LEVEL = { staff: 1, supervisor: 2, store_manager: 3, area_manager: 4, hq_admin: 5 }

export function actorIsRankAndFile() {
  const role = getMcpActorRole()
  return role === 'staff'
}

export function actorAtLeast(minRole) {
  const role = getMcpActorRole()
  if (!role) return true // no actor identity = API key / stdio, scope-gated
  return (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[minRole] || 99)
}

/**
 * Guard for any tool that reads one person's records. Returns the staff id the
 * query should actually run against.
 */
export function assertCanReadStaff(requestedStaffId, requestedLabel = 'that staff member') {
  const actorId = getMcpActorStaffId()
  if (!actorIsRankAndFile()) return requestedStaffId
  if (!requestedStaffId || requestedStaffId === actorId) return actorId
  throw new Error(`Permission denied: your FranHRM role (staff) can only access your own records, not ${requestedLabel}'s. Ask a supervisor or store manager for team-wide figures.`)
}

/** Guard for store/company-wide reads. */
export function assertManagerView(what = 'store-wide data') {
  if (actorAtLeast('supervisor')) return
  throw new Error(`Permission denied: ${what} requires a supervisor role or above. You can ask about your own hours, shifts and leave.`)
}

// Scope profiles. Default is SAFE (reads + request-creation), never
// unrestricted. `full` adds the privileged decision/publish scopes.
export const MCP_SCOPE_PROFILES = {
  safe: ['staff:read', 'org:read', 'roster:read', 'attendance:read', 'leave:read', 'leave:write', 'reports:read'],
  full: [
    'staff:read', 'staff:write',
    'org:read', 'org:write',
    'roster:read', 'roster:write', 'roster:publish',
    'attendance:read', 'attendance:write',
    'leave:read', 'leave:write', 'leave:approve',
    'reports:read', 'reports:cost',
    'hrm_schema:read', 'hrm_schema:write',
  ],
}

export const MCP_PRIVILEGED_SCOPES = ['roster:publish', 'leave:approve', 'staff:write', 'attendance:write', 'org:write']

/** null = unrestricted (explicit FRAN_HRM_MCP_PROFILE=unrestricted only). */
export function getMcpScopes() {
  const req = getReq()
  if (req) return Array.isArray(req.scopes) ? req.scopes : []
  const explicit = (process.env.FRAN_HRM_MCP_SCOPES || '').trim()
  if (explicit) return explicit.split(',').map((s) => s.trim()).filter(Boolean)
  const profile = (process.env.FRAN_HRM_MCP_PROFILE || 'safe').trim().toLowerCase()
  if (profile === 'unrestricted') return null
  return MCP_SCOPE_PROFILES[profile] || MCP_SCOPE_PROFILES.safe
}

export function describeMcpScopes() {
  const scopes = getMcpScopes()
  const profile = (process.env.FRAN_HRM_MCP_PROFILE || 'safe').trim().toLowerCase()
  return { profile, scopes, mode: getReq() ? 'remote' : 'stdio' }
}

export function requireScope(scope) {
  const scopes = getMcpScopes()
  if (scopes == null) return
  if (!scopes.includes(scope)) {
    throw new Error(`MCP scope denied: this action needs "${scope}". Your connection has: ${scopes.join(', ') || '(none)'}. Ask a FranHRM admin for an API key with the mcp:full package, or use FRAN_HRM_MCP_PROFILE=full on stdio.`)
  }
}

// ── Result helpers: everything is JSON-in-text, errors never escape ──
export function jsonResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] }
}

export function textResult(text) {
  return { content: [{ type: 'text', text: String(text) }] }
}

export function errorResult(err) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: err?.message || String(err) }, null, 2) }],
    isError: true,
  }
}
