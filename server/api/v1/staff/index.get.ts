import { listStaff } from '../../../../core/staff/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:read' })
  const q = getQuery(event)
  // Pay rates are AM+ only (spec: manpower cost view "only accessible by AM").
  const includeRate = ctx.has('reports:cost')
  return listStaff(getAdminClient(), ctx.workspaceId, {
    limit: q.limit,
    offset: q.offset,
    role: q.role,
    employment_type: q.employment_type,
    employment_status: q.employment_status,
    store_id: q.store_id,
    search: q.search,
  }, { includeRate })
})
