import { compactVersion, listVersions } from '../../../../core/hrm-schema/store.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'hrm_schema:read' })
  const q = getQuery(event)
  const rows = await listVersions(getAdminClient(), ctx.workspaceId, { limit: q.limit })
  return { data: rows.map(compactVersion), can_publish: ctx.has('hrm_schema:write') }
})
