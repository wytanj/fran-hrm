// Staff session auth: employee code (or email) + PIN → httpOnly cookie.
// FranHRM staff are not Supabase Auth users (same doctrine as fran-pos floor
// staff): the store floor logs in with a code + PIN, sessions live in
// staff_sessions with a sha256 token hash. 5 failed attempts = 15-min lockout.
import { createHash, randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { getAdminClient } from './supabase'

const COOKIE = 'fran_hrm_session'
const SESSION_DAYS = 14

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex')
}

export async function loginStaff(event: any, identifier: string, pin: string) {
  const db = getAdminClient()
  const id = String(identifier || '').trim()
  if (!id || !pin) throw apiError(400, 'Employee code/email and PIN are required')

  const col = id.includes('@') ? 'email' : 'employee_code'
  const { data: staff, error } = await db
    .from('staff')
    .select('*')
    .eq(col, id.includes('@') ? id.toLowerCase() : id.toUpperCase())
    .maybeSingle()
  if (error) throw apiError(500, error.message)

  const fail = () => apiError(401, 'Invalid employee code or PIN')
  if (!staff || staff.employment_status !== 'active' || !staff.pin_hash) throw fail()
  if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
    throw apiError(423, 'Account locked after repeated failed attempts. Try again in 15 minutes.')
  }

  if (!bcrypt.compareSync(String(pin), staff.pin_hash)) {
    const attempts = (staff.failed_attempts || 0) + 1
    await db.from('staff').update({
      failed_attempts: attempts,
      locked_until: attempts >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : staff.locked_until,
    }).eq('id', staff.id)
    throw fail()
  }

  await db.from('staff').update({ failed_attempts: 0, locked_until: null }).eq('id', staff.id)
  await issueStaffSession(event, staff)
  return staff
}

/**
 * Mint a fran_hrm_session cookie for a staff member. Shared by PIN login and
 * the SSO bridge — SSO verifies a Google token, resolves the member, then calls
 * this, so the rest of the app (requireActor) never learns about Supabase Auth.
 */
export async function issueStaffSession(event: any, staff: { id: string; workspace_id: string }) {
  const db = getAdminClient()
  const raw = randomBytes(32).toString('base64url')
  const expires = new Date(Date.now() + SESSION_DAYS * 86400000)
  const { error } = await db.from('staff_sessions').insert({
    workspace_id: staff.workspace_id,
    staff_id: staff.id,
    token_hash: hashToken(raw),
    user_agent: getHeader(event, 'user-agent')?.slice(0, 300) || null,
    expires_at: expires.toISOString(),
  })
  if (error) throw apiError(500, error.message)
  setCookie(event, COOKIE, raw, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  })
}

/** Verify a Supabase (Google) access token and return the identity, or null. */
export async function getSsoUser(accessToken: string) {
  if (!accessToken) return null
  const db = getAdminClient()
  const { data, error } = await db.auth.getUser(accessToken)
  if (error || !data?.user?.email) return null
  const u = data.user
  const meta: any = u.user_metadata || {}
  return {
    id: u.id,
    email: String(u.email).toLowerCase().trim(),
    name: meta.full_name || meta.name || String(u.email).split('@')[0],
  }
}

export async function getSessionStaff(event: any) {
  const raw = getCookie(event, COOKIE)
  if (!raw) return null
  const db = getAdminClient()
  const { data: session } = await db
    .from('staff_sessions')
    .select('*, staff:staff_id(*)')
    .eq('token_hash', hashToken(raw))
    .maybeSingle()
  if (!session || session.ended_at) return null
  if (new Date(session.expires_at) < new Date()) return null
  const staff = session.staff
  if (!staff || staff.employment_status !== 'active') return null
  db.from('staff_sessions').update({ last_seen_at: new Date().toISOString() }).eq('id', session.id)
    .then(() => {}, () => {})
  return staff
}

export async function logoutStaff(event: any) {
  const raw = getCookie(event, COOKIE)
  if (raw) {
    const db = getAdminClient()
    await db.from('staff_sessions').update({ ended_at: new Date().toISOString() }).eq('token_hash', hashToken(raw))
  }
  deleteCookie(event, COOKIE, { path: '/' })
}
