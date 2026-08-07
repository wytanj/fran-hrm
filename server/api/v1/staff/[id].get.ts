import { resolveStaff, compactStaff } from '../../../../core/staff/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:read' })
  const row = await resolveStaff(getAdminClient(), ctx.workspaceId, getRouterParam(event, 'id'))
  if (ctx.kind === 'session' && !hasTeamReach(ctx) && row.id !== ctx.staff.id) {
    throw apiError(403, 'You can only view your own profile')
  }
  const includeRate = ctx.has('reports:cost')
  return { data: compactStaff(row, { includeRate }) }
})
