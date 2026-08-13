import { listCatalog } from '../../../../../core/staff/profile.mjs'
import { FIELD_GROUPS } from '../../../../../core/staff/fields.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:read' })
  const q = getQuery(event)
  const fields = await listCatalog(getAdminClient(), ctx.workspaceId, {
    includeSensitive: true,
    includeInactive: q.include_inactive === 'true',
  })
  return {
    data: fields,
    groups: FIELD_GROUPS,
    can_edit: ctx.has('staff:write'),
  }
})
