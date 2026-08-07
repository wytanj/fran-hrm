import { getAccountability } from '../../../../core/org/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'org:read' })
  const result = await getAccountability(getAdminClient(), ctx.workspaceId, getRouterParam(event, 'key'))
  if (!result.found) throw apiError(404, result.message)
  return { data: result }
})
