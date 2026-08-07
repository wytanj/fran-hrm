import { recordAudit } from '../../../../core/audit/record.mjs'

// Create or update an accountability. Exactly one accountable owner is
// required — the DB constraint enforces it, and this gives a readable error
// before the constraint fires.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'org:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const key = String(body?.key || '').trim().toLowerCase()
  if (!key || !/^[a-z0-9-]+$/.test(key)) {
    throw apiError(400, 'key is required (lowercase letters, numbers and hyphens)')
  }
  if (!body?.name) throw apiError(400, 'name is required')
  if (!body.owner_position_id && !body.owner_staff_id) {
    throw apiError(400, 'An accountability needs exactly one owner: pass owner_position_id (preferred — survives turnover) or owner_staff_id.')
  }

  const { data: existing } = await db.from('accountabilities')
    .select('*').eq('workspace_id', ctx.workspaceId).eq('key', key).maybeSingle()

  const payload: Record<string, any> = {
    workspace_id: ctx.workspaceId,
    key,
    name: String(body.name).trim(),
    outcome: body.outcome || null,
    function_id: body.function_id || null,
    owner_position_id: body.owner_position_id || null,
    owner_staff_id: body.owner_staff_id || null,
    metric_name: body.metric_name || null,
    metric_target: body.metric_target ?? null,
    metric_unit: body.metric_unit || null,
    cadence: body.cadence || 'monthly',
    store_id: body.store_id || null,
    notes: body.notes || null,
    sort_order: Number(body.sort_order) || 100,
    updated_at: new Date().toISOString(),
  }
  if (body.status) payload.status = body.status

  const { data, error } = await db.from('accountabilities')
    .upsert(payload, { onConflict: 'workspace_id,key' }).select().single()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId,
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'accountabilities', entity_id: data.id,
    operation: existing ? 'UPDATE' : 'INSERT',
    before_data: existing || null, after_data: data,
  })
  return { data }
})
