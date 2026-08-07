// Generate a roster proposal from constraints. Writes a roster_run, never
// shifts — apply is a separate, deliberate step.
import { recordAudit } from '../../../../core/audit/record.mjs'
// @ts-ignore .mjs shared module
import { generateProposal } from '../../../../core/roster/intake.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const storeId = String(body?.store_id || (ctx.kind === 'session' ? ctx.staff.home_store_id : '') || '')
  if (!storeId) throw apiError(400, 'store_id is required')
  if (!body?.week_start) throw apiError(400, 'week_start is required (any date in the week; it snaps to Monday)')

  // Constraints inline, or from a saved set.
  let constraints = body.constraints
  let constraintSetId = body.constraint_set_id || null
  if (!constraints && constraintSetId) {
    const { data: set } = await db.from('roster_constraint_sets')
      .select('id, constraints').eq('workspace_id', ctx.workspaceId).eq('id', constraintSetId).maybeSingle()
    if (!set) throw apiError(404, 'Constraint set not found')
    constraints = set.constraints
  }
  if (!constraints && body.constraint_set_name) {
    const { data: set } = await db.from('roster_constraint_sets')
      .select('id, constraints').eq('workspace_id', ctx.workspaceId).eq('name', body.constraint_set_name).maybeSingle()
    if (!set) throw apiError(404, `No constraint set named "${body.constraint_set_name}"`)
    constraints = set.constraints
    constraintSetId = set.id
  }
  if (!constraints) {
    throw apiError(400, 'Provide constraints, or constraint_set_id / constraint_set_name. Minimum shape: { coverage: [{ weekday: "daily", blocks: [{ template: "Opening", count: 1 }] }] }')
  }

  try {
    const result = await generateProposal(db, ctx.workspaceId, {
      storeId,
      weekStart: String(body.week_start),
      constraints,
      constraintSetId,
      actor: {
        kind: ctx.kind === 'api_key' ? 'agent' : 'user',
        staffId: ctx.kind === 'session' ? ctx.staff.id : null,
        name: ctx.actorName,
      },
    })

    await recordAudit(db, {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
      object_type: 'roster_runs', entity_id: result.run_id, operation: 'INSERT',
      metadata: {
        action: 'generate_roster_proposal', week_start: result.week_start,
        filled: result.summary.filled, unfilled: result.summary.unfilled,
      },
    })

    return { data: result }
  } catch (err: any) {
    if (err.validation) {
      throw apiError(422, err.message, { errors: err.validation.errors, warnings: err.validation.warnings })
    }
    throw apiError(500, err.message)
  }
})
