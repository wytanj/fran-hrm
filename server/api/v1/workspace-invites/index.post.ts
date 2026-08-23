// Invite someone to JOIN this workspace with a role. No email is sent and no
// link is needed: the invitee signs in with Google using this email and is
// matched here automatically. staff:write invites at any role; staff:invite
// alone (store manager, area manager) is capped at the inviter's own role —
// an invite can carry any role, so that cap is the only thing stopping it
// from being a privilege-escalation path.
import { randomBytes } from 'node:crypto'
import { recordAudit } from '../../../../core/audit/record.mjs'
// @ts-ignore .mjs shared module
import { ROLES } from '../../../../core/permissions/catalog.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (!ctx.has('staff:write') && !ctx.has('staff:invite')) {
    throw denied('staff:invite', { scopes: ctx.scopes, role: ctx.role, kind: ctx.kind, name: ctx.actorName })
  }
  const body = await readBody(event)
  const db = getAdminClient()

  const email = String(body?.email || '').toLowerCase().trim()
  const role = String(body?.role || 'staff')
  if (!email.includes('@')) throw apiError(400, 'A valid email is required')
  if (!ROLES.includes(role)) throw apiError(400, `role must be one of: ${ROLES.join(', ')}`)
  if (!ctx.has('staff:write') && !roleAtLeast(ctx.role, role)) {
    throw apiError(403, `You cannot invite someone at a role senior to your own (${ctx.role}).`)
  }

  // One live invite per email/workspace — replace any existing pending one.
  await db.from('workspace_invites').delete()
    .eq('workspace_id', ctx.workspaceId).is('accepted_at', null).ilike('email', email)

  const { data, error } = await db.from('workspace_invites').insert({
    workspace_id: ctx.workspaceId,
    email,
    role,
    token: randomBytes(18).toString('base64url'),
    invited_by: ctx.kind === 'session' ? ctx.staff.id : null,
    note: body.note || null,
    expires_at: new Date(Date.now() + 14 * 86400_000).toISOString(),
  }).select().single()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'workspace_invites', entity_id: data.id, operation: 'INSERT',
    metadata: { action: 'invite_member', email, role },
  })
  return {
    data: { email: data.email, role: data.role, expires_at: data.expires_at },
    note: `Invited ${email} as ${role}. They join automatically when they sign in with Google using that email.`,
  }
})
