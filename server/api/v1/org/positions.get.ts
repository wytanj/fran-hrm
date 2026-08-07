import { listPositions, listStaffOrg, listFunctions } from '../../../../core/org/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'org:read' })
  const db = getAdminClient()
  const q = getQuery(event)

  const [positions, staff, functions] = await Promise.all([
    listPositions(db, ctx.workspaceId, { include_inactive: q.include_inactive === 'true' }),
    listStaffOrg(db, ctx.workspaceId, {}),
    listFunctions(db, ctx.workspaceId),
  ])

  const holders = new Map<string, any[]>()
  for (const s of staff) {
    if (!s.position_id) continue
    holders.set(s.position_id, [...(holders.get(s.position_id) || []), s])
  }

  return {
    data: positions.map((p: any) => ({
      ...p,
      holders: (holders.get(p.id) || []).map((h: any) => ({
        id: h.id, employee_code: h.employee_code, display_name: h.display_name, display_title: h.display_title,
      })),
      vacancies: Math.max(0, (p.headcount ?? 1) - (holders.get(p.id)?.length || 0)),
    })),
    functions,
    total: positions.length,
  }
})
