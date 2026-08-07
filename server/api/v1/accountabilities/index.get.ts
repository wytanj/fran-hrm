import { listAccountabilities, searchAccountabilities } from '../../../../core/org/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'org:read' })
  const db = getAdminClient()
  const q = getQuery(event)

  if (q.q) {
    return { data: await searchAccountabilities(db, ctx.workspaceId, String(q.q), { limit: Number(q.limit) || 5 }) }
  }

  const rows = await listAccountabilities(db, ctx.workspaceId, {
    status: q.status ? String(q.status) : undefined,
    function_key: q.function ? String(q.function) : undefined,
    store_id: q.store_id ? String(q.store_id) : undefined,
    owner_staff_id: q.owner_staff_id ? String(q.owner_staff_id) : undefined,
    unowned_only: q.unowned === 'true',
  })
  return {
    data: rows,
    total: rows.length,
    unowned: rows.filter((r: any) => !r.owner_resolved).length,
    at_risk: rows.filter((r: any) => r.status === 'at_risk').length,
  }
})
