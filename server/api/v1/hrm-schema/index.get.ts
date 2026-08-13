import { buildCurrentDocument, driftAgainst, ensureInForce, presentVersion } from '../../../../core/hrm-schema/store.mjs'
import { readGitMeta } from '../../../../core/hrm-schema/git.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'hrm_schema:read' })
  const db = getAdminClient()
  const git = readGitMeta()
  const { row, bootstrapped } = await ensureInForce(db, ctx.workspaceId, {
    git,
    actor: {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.kind === 'session' ? ctx.actorId : null, actor_name: ctx.actorName, source_type: ctx.sourceType,
    },
  })
  const current = await buildCurrentDocument(db, ctx.workspaceId)
  const drift = driftAgainst(row, current.core_hash, current.content_hash)
  return {
    data: {
      in_force: presentVersion(row),
      current_build: {
        core_hash: current.core_hash,
        content_hash: current.content_hash,
        git,
      },
      drift,
      bootstrapped,
      can_publish: ctx.has('hrm_schema:write'),
    },
  }
})
