import { buildOrgTree, listPositions, listStaffOrg } from '../../../../core/org/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'org:read' })
  const db = getAdminClient()
  const q = getQuery(event)
  const includeInactive = q.include_inactive === 'true'

  const [positions, staff] = await Promise.all([
    listPositions(db, ctx.workspaceId, { include_inactive: includeInactive }),
    listStaffOrg(db, ctx.workspaceId, { include_inactive: includeInactive }),
  ])
  return { data: buildOrgTree(positions, staff) }
})
