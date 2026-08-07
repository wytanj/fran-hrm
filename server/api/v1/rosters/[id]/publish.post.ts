import { rosterGuardrails } from '../../../../../core/roster/query.mjs'
import { recordAudit } from '../../../../../core/audit/record.mjs'

// Publish a draft roster. Guardrails (leave clashes, PT caps, OT projection,
// missing rest days) are computed first; publishing with open warnings
// requires force=true so the SM consciously accepts them.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:publish' })
  const body = await readBody(event).catch(() => ({}))
  const db = getAdminClient()
  const id = getRouterParam(event, 'id')

  const { data: roster } = await db
    .from('rosters').select('*').eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  if (!roster) throw apiError(404, 'Roster not found')

  const { data: shifts } = await db.from('shifts').select('*').eq('roster_id', roster.id).neq('status', 'cancelled')
  const settings = await getWorkspaceSettings(ctx.workspaceId)
  const warnings = await rosterGuardrails(db, ctx.workspaceId, roster, shifts || [], settings)
  if (warnings.length && !body?.force) {
    throw apiError(409, `Roster has ${warnings.length} guardrail warning(s). Review them and pass force=true to publish anyway.`, { warnings })
  }

  const isRepublish = roster.status === 'published'
  const { data: updated, error } = await db
    .from('rosters')
    .update({
      status: 'published',
      version: isRepublish ? (roster.version || 1) + 1 : roster.version,
      published_at: new Date().toISOString(),
      published_by: ctx.kind === 'session' ? ctx.staff.id : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', roster.id)
    .select()
    .single()
  if (error) throw apiError(500, error.message)

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'rosters', entity_id: roster.id, operation: 'ACTION',
    before_data: { status: roster.status, version: roster.version },
    after_data: { status: 'published', version: updated.version },
    metadata: { action: 'publish', warnings_accepted: warnings.length, shift_count: (shifts || []).length },
  })
  return { data: updated, warnings, published: true }
})
