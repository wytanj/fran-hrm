import { getStaffProfile, canSeeSensitiveFields } from '../../../../core/staff/profile.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:read' })
  const db = getAdminClient()
  const includeSensitive = canSeeSensitiveFields((s: string) => ctx.has(s))
  const profile = await getStaffProfile(db, ctx.workspaceId, getRouterParam(event, 'id'), { includeSensitive })
  if (ctx.kind === 'session' && !hasTeamReach(ctx) && profile.id !== ctx.staff.id) {
    throw apiError(403, 'You can only view your own profile')
  }
  return {
    data: {
      ...profile,
      can_edit: ctx.has('staff:write'),
      can_see_sensitive: includeSensitive,
    },
  }
})
