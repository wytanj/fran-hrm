// The change history for one roster — who adjusted which shift, when, and why.
// Read-only accountability for adjustments and disputes. Gated by roster:history
// (a configurable permission in the matrix), distinct from roster:write so a
// senior reviewer can be given visibility without the ability to edit.
// @ts-ignore .mjs shared module
import { rosterHistory } from '../../../../../core/audit/history.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:history' })
  const db = getAdminClient()

  const { data: roster, error } = await db
    .from('rosters')
    .select('id, store_id, week_start, status, version, store:store_id(code, name)')
    .eq('workspace_id', ctx.workspaceId).eq('id', getRouterParam(event, 'id')).maybeSingle()
  if (error) throw apiError(500, error.message)
  if (!roster) throw apiError(404, 'Roster not found')

  const result = await rosterHistory(db, ctx.workspaceId, roster)
  return { data: { ...result, store: roster.store } }
})
