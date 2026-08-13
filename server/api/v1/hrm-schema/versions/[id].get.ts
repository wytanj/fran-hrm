import { getVersion, presentVersion } from '../../../../../core/hrm-schema/store.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'hrm_schema:read' })
  const row = await getVersion(getAdminClient(), ctx.workspaceId, getRouterParam(event, 'id'))
  if (!row) throw apiError(404, 'No schema version with that id or number')
  return { data: presentVersion(row) }
})
