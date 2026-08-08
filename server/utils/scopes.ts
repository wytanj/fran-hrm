// Scope catalog for API keys and MCP. Format: domain:verb.
// Packages (mcp:*, pos_connector) expand to concrete scopes before checks —
// unexpanded packages would fail every scope test.

export const ALL_SCOPES = [
  'staff:read',
  'staff:write',
  // Org chart, titles, reporting lines and the accountability register.
  'org:read',
  'org:write',
  'roster:read',
  'roster:write',   // draft edits, shift assignment
  'roster:publish', // privileged: makes a roster visible to staff + T&A
  'roster:history', // read-only: the shift-change audit trail for disputes
  'attendance:read',
  'attendance:write', // clock actions, corrections decisions, imports
  'leave:read',
  'leave:write',    // create requests
  'leave:approve',  // privileged
  'reports:read',
  'pos:sync',       // fran-pos staff-directory pull
] as const

export const SCOPE_PACKAGES: Record<string, string[]> = {
  'mcp:safe': ['staff:read', 'org:read', 'roster:read', 'roster:history', 'attendance:read', 'leave:read', 'leave:write', 'reports:read'],
  'mcp:full': [...ALL_SCOPES],
  pos_connector: ['staff:read', 'pos:sync'],
}

export const PRIVILEGED_SCOPES = ['roster:publish', 'leave:approve', 'staff:write', 'attendance:write', 'org:write']

export function expandScopes(scopes: string[] | null | undefined): string[] {
  const out = new Set<string>()
  for (const s of scopes || []) {
    if (SCOPE_PACKAGES[s]) SCOPE_PACKAGES[s].forEach((x) => out.add(x))
    else out.add(s)
  }
  return [...out]
}

export const ROLE_LEVEL: Record<string, number> = {
  staff: 1,
  supervisor: 2,
  store_manager: 3,
  area_manager: 4,
  hq_admin: 5,
}

export function roleAtLeast(role: string | undefined, min: string): boolean {
  return (ROLE_LEVEL[role || ''] || 0) >= (ROLE_LEVEL[min] || 99)
}
