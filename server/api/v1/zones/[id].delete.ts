// Delete a zone. zones:write.
// @ts-ignore .mjs shared module
import { deleteZone } from '../../../../core/zones/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'zones:write' })
  const db = getAdminClient()
  return await deleteZone(db, ctx.workspaceId, String(getRouterParam(event, 'id')))
})
