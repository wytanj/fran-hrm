import { recordAudit } from '../../../../core/audit/record.mjs'
import { compactPosition, listPositions, wouldCreateCycle } from '../../../../core/org/query.mjs'

// Create or update a seat. Reporting-line changes are cycle-checked first —
// a loop would make the chart and every "who is my manager" query unresolvable.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'org:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const code = String(body?.code || '').trim().toUpperCase()
  if (!code) throw apiError(400, 'code is required')
  if (!body?.title) throw apiError(400, 'title (the internal/formal title) is required')

  const { data: existing } = await db.from('positions')
    .select('*').eq('workspace_id', ctx.workspaceId).eq('code', code).maybeSingle()

  if (body.reports_to_id && existing) {
    const positions = await listPositions(db, ctx.workspaceId, { include_inactive: true })
    if (wouldCreateCycle(positions, existing.id, body.reports_to_id)) {
      throw apiError(422, 'That reporting line would create a loop in the org chart.')
    }
  }

  const payload: Record<string, any> = {
    workspace_id: ctx.workspaceId,
    code,
    title: String(body.title).trim(),
    comms_title: body.comms_title ? String(body.comms_title).trim() : null,
    function_id: body.function_id || null,
    reports_to_id: body.reports_to_id || null,
    purpose: body.purpose || null,
    expected_role: body.expected_role || null,
    is_leadership: !!body.is_leadership,
    headcount: Math.max(1, Number(body.headcount) || 1),
    store_id: body.store_id || null,
    sort_order: Number(body.sort_order) || 100,
    updated_at: new Date().toISOString(),
  }
  if (body.is_active !== undefined) payload.is_active = !!body.is_active

  const { data, error } = await db.from('positions')
    .upsert(payload, { onConflict: 'workspace_id,code' }).select().single()
  if (error) throw apiError(400, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId,
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'positions', entity_id: data.id,
    operation: existing ? 'UPDATE' : 'INSERT',
    before_data: existing ? compactPosition(existing) : null,
    after_data: compactPosition(data),
  })
  return { data: compactPosition(data) }
})
