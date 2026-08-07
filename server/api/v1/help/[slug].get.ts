import { getHelpArticle } from '../../../../core/help/resolve.mjs'

export default defineEventHandler(async (event) => {
  const staff = await getSessionStaff(event)
  const workspaceId = staff?.workspace_id || (await requireActor(event)).workspaceId
  const article = await getHelpArticle(getAdminClient(), workspaceId, getRouterParam(event, 'slug'))
  if (!article.found) throw apiError(404, article.message)
  return { data: article }
})
