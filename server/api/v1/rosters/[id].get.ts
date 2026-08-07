import { compactShift, rosterGuardrails } from '../../../../core/roster/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const db = getAdminClient()
  const id = getRouterParam(event, 'id')

  const { data: roster, error } = await db
    .from('rosters')
    .select('*, store:store_id(id, code, name)')
    .eq('workspace_id', ctx.workspaceId)
    .eq('id', id)
    .maybeSingle()
  if (error) throw apiError(500, error.message)
  if (!roster) throw apiError(404, 'Roster not found')
  if (roster.status === 'draft') {
    const canSeeDraft = ctx.has('roster:write')
    if (!canSeeDraft) throw apiError(404, 'Roster not found')
  }

  const { data: shifts, error: shErr } = await db
    .from('shifts')
    .select('*, staff:staff_id(id, employee_code, display_name, employment_type)')
    .eq('roster_id', roster.id)
    .neq('status', 'cancelled')
    .order('work_date')
    .order('start_at')
  if (shErr) throw apiError(500, shErr.message)

  const settings = await getWorkspaceSettings(ctx.workspaceId)
  const warnings = await rosterGuardrails(db, ctx.workspaceId, roster, shifts || [], settings)
  return { data: { ...roster, shifts: (shifts || []).map(compactShift) }, warnings }
})
