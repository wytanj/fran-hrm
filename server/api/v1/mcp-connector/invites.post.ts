import { randomBytes } from 'node:crypto'
import { recordAudit } from '../../../../core/audit/record.mjs'
import { mcpOauthIssuer } from '../../../utils/mcpOauth'

// Create a connect-invite link. The invite records that an admin intended this
// person to connect; it grants no power of its own — scopes always come from
// the staff member's live role once they sign in.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'connector:manage' })
  const body = await readBody(event).catch(() => ({}))
  const db = getAdminClient()

  const days = Math.min(Math.max(Number(body?.expires_in_days) || 7, 1), 30)
  const token = randomBytes(24).toString('base64url')

  const { data, error } = await db.from('mcp_connect_invites').insert({
    workspace_id: ctx.workspaceId,
    token,
    staff_id: body?.staff_id || null,
    note: body?.note || null,
    created_by: ctx.kind === 'session' ? ctx.staff.id : null,
    expires_at: new Date(Date.now() + days * 86400_000).toISOString(),
  }).select().single()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId,
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'mcp_connect_invites', entity_id: data.id, operation: 'INSERT',
    metadata: { action: 'create_connect_invite', for_staff: body?.staff_id || 'anyone' },
  })

  return {
    data: {
      url: `${mcpOauthIssuer(event)}/oauth/connect?invite=${token}`,
      expires_at: data.expires_at,
    },
  }
})
