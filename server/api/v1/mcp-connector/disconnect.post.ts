import { recordAudit } from '../../../../core/audit/record.mjs'
import { revokeMcpOauthTokensForStaff } from '../../../utils/mcpOauth'

// Revoke a staff member's Claude connection. They must click Connect again.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'connector:manage' })
  const body = await readBody(event)
  const db = getAdminClient()
  const staffId = String(body?.staff_id || '')
  if (!staffId) throw apiError(400, 'staff_id is required')

  const revoked = await revokeMcpOauthTokensForStaff(db, ctx.workspaceId, staffId)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId,
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'mcp_oauth_tokens', entity_id: staffId, operation: 'ACTION',
    metadata: { action: 'disconnect_claude', tokens_revoked: revoked },
  })

  return { ok: true, tokens_revoked: revoked }
})
