import { saveWorkspaceSchedulingRules, resetWorkspaceSchedulingRules } from '../../../../core/scheduling/rules.mjs'

// Replace (or reset) the workspace's scheduling rules. Body: { rules } for a
// full or partial document (merged onto the current one), or
// { reset: true } to drop the override and fall back to the file defaults.
// Validation errors come back as one 422 listing every bad field.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const body = await readBody(event).catch(() => ({}))
  const db = getAdminClient()
  const actor = {
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    staff_id: ctx.kind === 'session' ? ctx.staff.id : null,
  }
  try {
    const result = body?.reset === true
      ? await resetWorkspaceSchedulingRules(db, ctx.workspaceId, actor)
      : await saveWorkspaceSchedulingRules(db, ctx.workspaceId, body?.rules ?? body, actor)
    return { data: result.rules, version: result.version, source: result.source, updated_at: result.updated_at, ok: true }
  } catch (err: any) {
    if (err?.errors) throw apiError(422, err.message, { errors: err.errors })
    throw apiError(400, err?.message || 'Could not save scheduling rules')
  }
})
