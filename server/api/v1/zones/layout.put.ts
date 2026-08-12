// Set a store's floor-plan layout image. zones:write.
// @ts-ignore .mjs shared module
import { setLayout } from '../../../../core/zones/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'zones:write' })
  const body = await readBody(event)
  const db = getAdminClient()
  const storeId = String(body?.store_id || '')
  if (!storeId) throw apiError(400, 'store_id is required')
  const layout = await setLayout(db, ctx.workspaceId, storeId, {
    image_data_url: body.image_data_url,
    source: body.source,
    aspect: body.aspect,
    actorStaffId: ctx.kind === 'session' ? ctx.staff.id : null,
  }).catch((err: any) => { throw apiError(422, err.message) })
  return { data: layout }
})
