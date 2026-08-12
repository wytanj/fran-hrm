// Zones + layout for a store. zones:read.
// @ts-ignore .mjs shared module
import { listZones, getLayout } from '../../../../core/zones/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'zones:read' })
  const storeId = String(getQuery(event).store_id || '')
  if (!storeId) throw apiError(400, 'store_id is required')
  const db = getAdminClient()
  const [zones, layout] = await Promise.all([
    listZones(db, ctx.workspaceId, storeId),
    getLayout(db, ctx.workspaceId, storeId),
  ])
  return { data: { zones, layout } }
})
