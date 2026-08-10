// Signed, short-lived staff check-in tokens for the REVERSE-scan flow: the
// staff member shows a rotating QR of their own identity, a supervisor's
// scanner reads it. The token is stateless (HMAC-signed), so refreshing it
// every minute costs no DB writes — and a stale screenshot is useless within
// ~a minute. The security control is the supervisor witnessing the scan; this
// just proves the code is fresh and names who it belongs to.
import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_TTL_MS = 60_000

function signingSecret(): string {
  // Reuse the service-role secret (server-only, never shipped to the client)
  // so no new env var is needed. Rotating it invalidates outstanding tokens,
  // which is harmless — they live ~a minute.
  const s = process.env.SUPABASE_SECRET_KEY
  if (!s) throw new Error('SUPABASE_SECRET_KEY is not set — cannot sign staff check-in tokens')
  return s
}

function sign(payload: string): string {
  return createHmac('sha256', signingSecret()).update(payload).digest('base64url')
}

/** Mint a token that says "this is staff X, valid until T". */
export function mintStaffClockToken(staffId: string, ttlMs = DEFAULT_TTL_MS) {
  const exp = Date.now() + ttlMs
  const payload = `${staffId}.${exp}`
  const token = `hrmstaff.${Buffer.from(payload).toString('base64url')}.${sign(payload)}`
  return { token, expires_at: new Date(exp).toISOString(), ttl_ms: ttlMs }
}

/** Verify signature + freshness. Returns the staff id, or null if bad/expired. */
export function verifyStaffClockToken(token: unknown): { staffId: string } | null {
  if (typeof token !== 'string' || !token.startsWith('hrmstaff.')) return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  let payload: string
  try { payload = Buffer.from(parts[1], 'base64url').toString('utf8') } catch { return null }
  const expected = sign(payload)
  const got = Buffer.from(parts[2])
  const want = Buffer.from(expected)
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null
  const [staffId, expStr] = payload.split('.')
  const exp = Number(expStr)
  if (!staffId || !Number.isFinite(exp) || Date.now() > exp) return null
  return { staffId }
}
