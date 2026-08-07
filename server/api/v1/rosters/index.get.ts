import { getRoster } from '../../../../core/roster/query.mjs'
import { assertDate, mondayOf } from '../../../utils/dates'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const q = getQuery(event)
  const db = getAdminClient()

  // Single-week fetch: ?store_id&week_start (staff see published only)
  if (q.store_id && q.week_start) {
    // Drafts are for whoever builds rosters — that is roster:write, by permission.
    const includeDraft = ctx.has('roster:write')
    const roster = await getRoster(db, ctx.workspaceId, {
      store_id: String(q.store_id),
      week_start: mondayOf(assertDate(q.week_start, 'week_start')),
      include_draft: includeDraft && q.include_draft !== 'false',
    })
    return { data: roster }
  }

  // Listing: recent rosters, optionally per store
  let listQ = db
    .from('rosters')
    .select('id, store_id, week_start, status, version, published_at, notes, store:store_id(code, name)')
    .eq('workspace_id', ctx.workspaceId)
    .order('week_start', { ascending: false })
    .limit(30)
  if (q.store_id) listQ = listQ.eq('store_id', String(q.store_id))
  if (!ctx.has('roster:write')) listQ = listQ.eq('status', 'published')
  const { data, error } = await listQ
  if (error) throw apiError(500, error.message)
  return { data: data || [] }
})
