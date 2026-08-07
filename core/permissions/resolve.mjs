// Resolve what a staff member may actually do: the role matrix, then their
// personal grants and revocations layered on top.
//
// Cached briefly per workspace — permission checks run on every request, and a
// matrix edit taking up to a minute to propagate is an acceptable trade for not
// hitting the DB twice per API call. Call invalidatePermissionCache() after an
// edit so the admin sees their own change immediately.
import { DEFAULT_ROLE_MATRIX, SCOPE_KEYS } from './catalog.mjs'

const CACHE_MS = 60_000
const matrixCache = new Map() // workspaceId → { at, matrix }

export function invalidatePermissionCache(workspaceId) {
  if (workspaceId) matrixCache.delete(workspaceId)
  else matrixCache.clear()
}

/**
 * The workspace's role → Set(scope) matrix.
 * Rows are authoritative when any exist; a missing row means denied.
 */
export async function getRoleMatrix(db, workspaceId) {
  const cached = matrixCache.get(workspaceId)
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.matrix

  const { data, error } = await db
    .from('role_permissions').select('role, scope, allowed').eq('workspace_id', workspaceId)
  if (error) throw new Error(error.message)

  const matrix = {}
  if (!data?.length) {
    // Nothing configured for this workspace — fall back to the shipped defaults.
    for (const [role, scopes] of Object.entries(DEFAULT_ROLE_MATRIX)) matrix[role] = new Set(scopes)
  } else {
    for (const row of data) {
      matrix[row.role] ||= new Set()
      if (row.allowed) matrix[row.role].add(row.scope)
    }
  }

  matrixCache.set(workspaceId, { at: Date.now(), matrix })
  return matrix
}

export async function scopesForRole(db, workspaceId, role) {
  const matrix = await getRoleMatrix(db, workspaceId)
  return [...(matrix[role] || new Set())]
}

/**
 * Everything one staff member may do: their role's scopes, plus personal
 * grants, minus personal revocations. Expired grants are ignored.
 *
 * Terminated or inactive staff resolve to nothing — the same fail-closed rule
 * the OAuth layer relies on so offboarding takes effect immediately.
 */
export async function resolveStaffScopes(db, workspaceId, staff) {
  if (!staff || staff.employment_status !== 'active') {
    return { scopes: [], role: staff?.role || null, overrides: [] }
  }

  const [roleScopes, { data: grants }] = await Promise.all([
    scopesForRole(db, workspaceId, staff.role),
    db.from('staff_permission_grants')
      .select('scope, allowed, expires_at, reason')
      .eq('staff_id', staff.id),
  ])

  const set = new Set(roleScopes)
  const applied = []
  const now = Date.now()

  for (const g of grants || []) {
    if (g.expires_at && new Date(g.expires_at).getTime() < now) continue
    if (!SCOPE_KEYS.includes(g.scope)) continue // stale scope from an older build
    if (g.allowed) {
      if (!set.has(g.scope)) applied.push({ ...g, effect: 'granted' })
      set.add(g.scope)
    } else {
      if (set.has(g.scope)) applied.push({ ...g, effect: 'revoked' })
      set.delete(g.scope)
    }
  }

  return { scopes: [...set], role: staff.role, overrides: applied }
}

export async function staffHasScope(db, workspaceId, staff, scope) {
  const { scopes } = await resolveStaffScopes(db, workspaceId, staff)
  return scopes.includes(scope)
}

/** Matrix shaped for the admin UI: rows of scope × role booleans. */
export async function describeMatrix(db, workspaceId) {
  const matrix = await getRoleMatrix(db, workspaceId)
  const { count } = await db
    .from('role_permissions').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId)
  return {
    configured: (count || 0) > 0,
    matrix: Object.fromEntries(Object.entries(matrix).map(([role, set]) => [role, [...set]])),
  }
}
