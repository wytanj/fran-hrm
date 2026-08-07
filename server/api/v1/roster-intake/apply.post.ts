// Turn a proposed run (generated or imported) into a DRAFT roster.
import { recordAudit } from '../../../../core/audit/record.mjs'
// @ts-ignore .mjs shared module
import { applyRun } from '../../../../core/roster/intake.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const runId = String(body?.run_id || '')
  if (!runId) throw apiError(400, 'run_id is required')

  try {
    const result = await applyRun(db, ctx.workspaceId, runId, {
      actor: {
        kind: ctx.kind === 'api_key' ? 'agent' : 'user',
        staffId: ctx.kind === 'session' ? ctx.staff.id : null,
        name: ctx.actorName,
      },
      replace: !!body.replace,
    })

    await recordAudit(db, {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
      object_type: 'rosters', entity_id: result.roster_id, operation: 'ACTION',
      metadata: { action: 'apply_roster_run', run_id: runId, created: result.created, replace: !!body.replace },
    })

    return { data: result }
  } catch (err: any) {
    throw apiError(422, err.message)
  }
})
