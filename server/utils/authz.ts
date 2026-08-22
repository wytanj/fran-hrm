// Unified authorization for /api/v1 routes: accepts EITHER an API key
// (scopes from the key) OR a staff session cookie (scopes resolved from the
// workspace's editable role matrix plus that person's grants).
//
// Scopes are the gate for BOTH actor kinds. Routes no longer hardcode role
// floors, so "let this supervisor publish rosters" is a matrix edit rather
// than a code change. `minRole` remains available for the rare check that is
// genuinely about seniority rather than capability.
import { authenticateApiKey } from './apiAuth'
import { getSessionStaff } from './sessionAuth'
import { getAdminClient } from './supabase'
import { roleAtLeast } from './scopes'
// @ts-ignore .mjs shared module
import { resolveStaffScopes } from '../../core/permissions/resolve.mjs'
// @ts-ignore .mjs shared module
import { scopeMeta } from '../../core/permissions/catalog.mjs'

export interface ActorContext {
  workspaceId: string
  kind: 'api_key' | 'session'
  scopes: string[]
  staff: any | null
  actorId: string | null
  actorName: string
  role: string | null
  sourceType: 'api' | 'web'
  /** Personal grants/revocations that applied, for audit and debugging. */
  overrides: any[]
  has: (scope: string) => boolean
}

export function denied(scope: string, ctx: { scopes: string[]; role: string | null; kind: string; name: string }) {
  const meta = scopeMeta(scope)
  const what = meta ? `"${meta.label}" (${scope})` : `"${scope}"`
  if (ctx.kind === 'api_key') {
    return apiError(403, `API key "${ctx.name}" lacks the ${what} permission. It has: ${ctx.scopes.join(', ') || '(none)'}`)
  }
  return apiError(403, `You do not have the ${what} permission. Your role (${ctx.role}) can be granted it in Settings → Permissions, or an admin can grant it to you individually.`)
}

/**
 * @param opts.scope   permission required (checked for API keys AND sessions)
 * @param opts.minRole additional seniority floor; use only when the check is
 *                     about rank rather than capability
 */
export async function requireActor(
  event: any,
  opts: { scope?: string; minRole?: string } = {},
): Promise<ActorContext> {
  const key = await authenticateApiKey(event)
  if (key) {
    const has = (s: string) => key.scopes.includes(s)
    if (opts.scope && !has(opts.scope)) {
      throw denied(opts.scope, { scopes: key.scopes, role: null, kind: 'api_key', name: key.keyName })
    }
    return {
      workspaceId: key.workspaceId,
      kind: 'api_key',
      scopes: key.scopes,
      staff: null,
      actorId: key.keyId,
      actorName: key.keyName,
      role: null,
      sourceType: 'api',
      overrides: [],
      has,
    }
  }

  const staff = await getSessionStaff(event)
  if (!staff) {
    throw apiError(401, 'Sign in required (session cookie or API key)')
  }

  const { scopes, overrides } = await resolveStaffScopes(getAdminClient(), staff.workspace_id, staff)
  const has = (s: string) => scopes.includes(s)

  if (opts.scope && !has(opts.scope)) {
    throw denied(opts.scope, { scopes, role: staff.role, kind: 'session', name: staff.display_name })
  }
  if (opts.minRole && !roleAtLeast(staff.role, opts.minRole)) {
    throw apiError(403, `Requires ${opts.minRole} role or above`)
  }

  return {
    workspaceId: staff.workspace_id,
    kind: 'session',
    scopes,
    staff,
    actorId: staff.id,
    actorName: staff.display_name,
    role: staff.role,
    sourceType: 'web',
    overrides,
    has,
  }
}

/**
 * Managers see everyone; someone without team-wide reach sees only themselves.
 *
 * Reach is a permission, not a rank. Any *:write scope means "acts on other
 * people's records" (see migration 010) — that is what separates a supervisor
 * from a shop-floor staff member, and it moves the moment the matrix does.
 */
export function limitToSelf(ctx: ActorContext, requestedStaffId?: string | null): string | null {
  if (ctx.kind === 'api_key') return requestedStaffId || null
  if (hasTeamReach(ctx)) return requestedStaffId || null
  return ctx.staff.id
}

const TEAM_REACH_SCOPES = [
  'roster:write', 'roster:publish', 'attendance:write',
  'leave:approve', 'staff:write', 'reports:cost', 'payroll:lock',
]

/** Does this actor act on, or see, other people's records at all? */
export function hasTeamReach(ctx: ActorContext): boolean {
  if (ctx.kind === 'api_key') return true
  return TEAM_REACH_SCOPES.some((s) => ctx.has(s))
}

/** Guard for endpoints that are inherently store- or company-wide. */
export function assertTeamReach(ctx: ActorContext, what = 'this view'): void {
  if (hasTeamReach(ctx)) return
  throw apiError(403, `${what} covers the whole team. Your permissions only cover your own records — ask an admin for a scheduling or attendance permission if you need it.`)
}

const settingsCache = new Map<string, { value: any; at: number }>()

export async function getWorkspaceSettings(workspaceId: string): Promise<any> {
  const cached = settingsCache.get(workspaceId)
  if (cached && Date.now() - cached.at < 60_000) return cached.value
  const db = getAdminClient()
  const { data } = await db.from('workspaces').select('settings').eq('id', workspaceId).maybeSingle()
  const value = data?.settings || {}
  settingsCache.set(workspaceId, { value, at: Date.now() })
  return value
}
