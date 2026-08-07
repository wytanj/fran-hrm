import { listStores } from '../../../core/staff/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:read' })
  const data = await listStores(getAdminClient(), ctx.workspaceId)
  return { data, total: data.length }
})
