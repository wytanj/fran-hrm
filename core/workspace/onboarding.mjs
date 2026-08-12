// SSO onboarding: resolve/join/create the workspace a Google identity belongs
// to. Pure DB logic (service-role client), shared by the auth endpoints.
//
// Rule set (decided): joining an existing workspace is invite-only; CREATING a
// new one is restricted to an env allowlist; one workspace per Google account
// for now.
import { randomBytes } from 'node:crypto'

/** Allowlist entries: an entry with '@' is an exact email; otherwise a domain. */
export function createAllowlist() {
  return String(process.env.WORKSPACE_CREATE_ALLOWLIST || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
}
export function isCreateAllowed(email) {
  const e = String(email || '').toLowerCase().trim()
  if (!e || !e.includes('@')) return false
  const domain = e.split('@')[1] || ''
  return createAllowlist().some((entry) => (entry.includes('@') ? entry === e : entry === domain))
}

function genCode(prefix) {
  return `${prefix}-${randomBytes(2).toString('hex').toUpperCase()}`
}
function slugify(name) {
  const base = String(name || 'workspace').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'workspace'
  return `${base}-${randomBytes(3).toString('hex')}`
}

/** The active member for this Google identity (by auth link, then by email). */
export async function resolveMember(db, { authUserId, email }) {
  if (authUserId) {
    const { data } = await db.from('staff').select('*')
      .eq('auth_user_id', authUserId).eq('employment_status', 'active').maybeSingle()
    if (data) return data
  }
  if (email) {
    const { data } = await db.from('staff').select('*')
      .ilike('email', email).eq('employment_status', 'active').order('created_at').limit(1)
    if (data && data[0]) return data[0]
  }
  return null
}

/** Bind a Google identity to an existing (e.g. previously PIN-only) staff row. */
export async function linkAuthUser(db, staffId, authUserId) {
  await db.from('staff').update({ auth_user_id: authUserId, access_method: 'sso', updated_at: new Date().toISOString() }).eq('id', staffId)
}

/** The newest live, unexpired invite for this email, or null. */
export async function findPendingInvite(db, email) {
  const { data } = await db.from('workspace_invites').select('*')
    .ilike('email', email).is('accepted_at', null).gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false }).limit(1)
  return (data && data[0]) || null
}

/** Accept an invite: create the member in that workspace with the invited role. */
export async function acceptInvite(db, invite, { authUserId, email, name }) {
  const { data: staff, error } = await db.from('staff').insert({
    workspace_id: invite.workspace_id,
    employee_code: genCode('SSO'),
    display_name: name || email,
    email,
    role: invite.role,
    employment_type: 'full_time',
    employment_status: 'active',
    auth_user_id: authUserId,
    access_method: 'sso',
  }).select().single()
  if (error) throw new Error(error.message)
  await db.from('workspace_invites').update({
    accepted_at: new Date().toISOString(), accepted_staff_id: staff.id,
  }).eq('id', invite.id)
  return staff
}

/**
 * Create a new workspace and its founding hq_admin. Idempotent: if the identity
 * already has a member, that member is returned instead of a second workspace.
 */
export async function createWorkspace(db, { authUserId, email, name, orgName }) {
  const existing = await resolveMember(db, { authUserId, email })
  if (existing) return { staff: existing, created: false }

  const { data: ws, error: wsErr } = await db.from('workspaces').insert({
    name: String(orgName || name || email).slice(0, 80),
    slug: slugify(orgName || name || email),
  }).select().single()
  if (wsErr) throw new Error(wsErr.message)

  const { data: staff, error } = await db.from('staff').insert({
    workspace_id: ws.id,
    employee_code: genCode('ADM'),
    display_name: name || email,
    email,
    role: 'hq_admin',
    employment_type: 'full_time',
    employment_status: 'active',
    auth_user_id: authUserId,
    access_method: 'sso',
  }).select().single()
  if (error) throw new Error(error.message)

  await db.from('workspaces').update({ created_by: staff.id }).eq('id', ws.id)
  return { staff, workspace: ws, created: true }
}
