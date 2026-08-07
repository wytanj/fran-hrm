// Save (or update) a reusable constraint set. Validated before storing so a
// broken set can never sit waiting to fail at generation time.
import { recordAudit } from '../../../../core/audit/record.mjs'
// @ts-ignore .mjs shared module
import { validateConstraints, explainConstraints } from '../../../../core/roster/constraints.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const name = String(body?.name || '').trim()
  if (!name) throw apiError(400, 'name is required')
  const storeId = body?.store_id || (ctx.kind === 'session' ? ctx.staff.home_store_id : null)

  const { data: templates } = await db.from('shift_templates')
    .select('id, name, start_time, end_time, break_minutes')
    .eq('workspace_id', ctx.workspaceId).eq('is_active', true)

  const validated = validateConstraints(body?.constraints, { templates: templates || [] })
  if (!validated.ok) {
    throw apiError(422, `Constraints are not usable:\n- ${validated.errors.join('\n- ')}`, { errors: validated.errors, warnings: validated.warnings })
  }

  const { data, error } = await db.from('roster_constraint_sets').upsert({
    workspace_id: ctx.workspaceId,
    store_id: storeId,
    name,
    description: body.description || null,
    constraints: validated.constraints,
    is_default: !!body.is_default,
    created_by: ctx.kind === 'session' ? ctx.staff.id : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id,store_id,name' }).select().single()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId,
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'roster_constraint_sets', entity_id: data.id, operation: 'UPDATE',
    after_data: { name, slots: validated.slot_count },
    metadata: { action: 'save_constraint_set' },
  })

  return {
    data,
    slot_count: validated.slot_count,
    warnings: validated.warnings,
    explained: explainConstraints(validated.constraints),
  }
})
