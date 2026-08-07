// Help articles: list, or search with ?q=. Any signed-in staff member (and
// any API key) may read help — it is documentation, not staff data.
import { listHelpArticles, resolveHelp } from '../../../../core/help/resolve.mjs'

export default defineEventHandler(async (event) => {
  const staff = await getSessionStaff(event)
  const workspaceId = staff?.workspace_id || (await requireActor(event)).workspaceId
  const q = getQuery(event)
  const db = getAdminClient()

  if (q.q) {
    return { data: await resolveHelp(db, workspaceId, String(q.q), { limit: q.limit, role: staff?.role }) }
  }
  const articles = await listHelpArticles(db, workspaceId, { category: q.category ? String(q.category) : undefined })
  return { data: articles, total: articles.length }
})
