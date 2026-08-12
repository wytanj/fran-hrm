// Update a zone (rename, recolour, move/resize). zones:write.
// @ts-ignore .mjs shared module
import { updateZone } from '../../../../core/zones/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'zones:write' })
  const body = await readBody(event)
  const db = getAdminClient()
  const zone = await updateZone(db, ctx.workspaceId, String(getRouterParam(event, 'id')), body)
    .catch((err: any) => { throw apiError(422, err.message) })
  return { data: zone }
})
