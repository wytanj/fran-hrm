import { recordAudit } from '../../../../core/audit/record.mjs'
import { createOrRotateMcpOauthClient } from '../../../utils/mcpOauth'

// Generate (or rotate) the OAuth client credentials the admin pastes into
// Claude. The secret is returned exactly once.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'connector:manage' })
  const body = await readBody(event).catch(() => ({}))
  const db = getAdminClient()

  const result = await createOrRotateMcpOauthClient(db, {
    workspaceId: ctx.workspaceId,
    staffId: ctx.kind === 'session' ? ctx.staff.id : null,
    label: body?.label || null,
  })

  await recordAudit(db, {
    workspace_id: ctx.workspaceId,
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'mcp_oauth_clients', operation: 'ACTION',
    metadata: { action: result.rotated ? 'rotate_client_secret' : 'create_client', client_id: result.clientId },
  })

  return {
    data: {
      client_id: result.clientId,
      client_secret: result.clientSecret,
      rotated: result.rotated,
      note: 'Save the secret now — it is not shown again. Paste both into Claude → Connectors → Advanced.',
    },
  }
})
