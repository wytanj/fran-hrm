import { submitAvailability } from '../../../../core/roster/query.mjs'
import { getWorkspaceSchedulingRules } from '../../../../core/scheduling/rules.mjs'

// Staff submit availability/preferences for future dates. All guards
// (availability_required flag, the workspace cutoff, the scheduling-rules
// month lock, manager locks) live in core submitAvailability so the Telegram
// bot and MCP apply exactly the same policy. roster:write callers bypass
// every guard — they plan for others.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const body = await readBody(event)
  const db = getAdminClient()

  let staffId = ctx.kind === 'session' ? ctx.staff.id : body?.staff_id
  if (body?.staff_id && ctx.has('roster:write')) staffId = body.staff_id
  if (!staffId) throw apiError(400, 'staff_id is required for API-key callers')

  const [settings, rulesRes] = await Promise.all([
    getWorkspaceSettings(ctx.workspaceId),
    getWorkspaceSchedulingRules(db, ctx.workspaceId),
  ])

  try {
    const { data } = await submitAvailability(db, ctx.workspaceId, {
      staffId,
      entries: Array.isArray(body?.entries) ? body.entries : [],
      isManager: ctx.has('roster:write'),
      cutoffDays: Number(settings.availability_cutoff_days) || 7,
      rules: rulesRes.rules,
    }, {
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    })
    return { data, ok: true }
  } catch (err: any) {
    throw apiError(err?.status || 400, err?.message || 'Could not save availability')
  }
})
