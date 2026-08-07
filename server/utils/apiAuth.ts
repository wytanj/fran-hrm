// API-key authentication for headless clients (MCP connectors, fran-pos
// pull, exporters). sha256(key) is stored; the plaintext sk_live_… is shown
// once at creation. Key lookup order mirrors fran-skums: context (URL-embedded
// for /mcp/c/:token) → Authorization: Bearer → X-API-Key → query params.
import { createHash, randomBytes } from 'node:crypto'
import { getAdminClient } from './supabase'
import { expandScopes } from './scopes'

export interface ApiKeyContext {
  keyId: string
  keyName: string
  workspaceId: string
  scopes: string[]
}

export function generateApiKey(): { raw: string; hash: string; prefix: string } {
  const raw = `sk_live_${randomBytes(32).toString('base64url')}`
  return { raw, hash: hashApiKey(raw), prefix: raw.slice(0, 16) }
}

export function hashApiKey(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

function extractKey(event: any): string | null {
  if (event.context.mcpApiKey) return String(event.context.mcpApiKey)
  const auth = getHeader(event, 'authorization')
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim()
  const xKey = getHeader(event, 'x-api-key')
  if (xKey) return xKey.trim()
  const q = getQuery(event)
  for (const name of ['api_key', 'key', 'access_token', 'token']) {
    if (typeof q[name] === 'string' && q[name]) return String(q[name]).trim()
  }
  return null
}

export async function authenticateApiKey(event: any): Promise<ApiKeyContext | null> {
  const raw = extractKey(event)
  if (!raw || !raw.startsWith('sk_')) return null
  const db = getAdminClient()
  const { data: row, error } = await db
    .from('api_keys')
    .select('*')
    .eq('key_hash', hashApiKey(raw))
    .maybeSingle()
  if (error || !row) return null
  if (!row.is_active || row.revoked_at) return null
  if (row.expires_at && new Date(row.expires_at) < new Date()) return null
  // Fire-and-forget usage bookkeeping — never blocks the request.
  db.from('api_keys')
    .update({ last_used_at: new Date().toISOString(), usage_count: (row.usage_count || 0) + 1 })
    .eq('id', row.id)
    .then(() => {}, () => {})
  return {
    keyId: row.id,
    keyName: row.name,
    workspaceId: row.workspace_id,
    scopes: expandScopes(row.scopes),
  }
}
