import { setAvailabilityRequired } from '../../../../../core/staff/profile.mjs'

// Narrow action: flag whether this person must submit day-by-day
// availability. Store managers hold staff:availability_flag without
// staff:write; area/HQ holding staff:write should not need a second scope.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (!ctx.has('staff:availability_flag') && !ctx.has('staff:write')) {
    throw denied('staff:availability_flag', { scopes: ctx.scopes, role: ctx.role, kind: ctx.kind, name: ctx.actorName })
  }

  const id = getRouterParam(event, 'id')
  const body = await readBody(event) || {}
  if (typeof body.required !== 'boolean') {
    throw apiError(400, 'required (boolean) is needed')
  }

  const db = getAdminClient()
  const { data: target } = await db.from('staff')
    .select('id')
    .eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  if (!target) throw apiError(404, 'Staff not found')

  try {
    const data = await setAvailabilityRequired(db, ctx.workspaceId, id, body.required, {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    })
    return { ok: true, data }
  } catch (err: any) {
    throw apiError(400, err?.message || 'Could not update availability required')
  }
})
