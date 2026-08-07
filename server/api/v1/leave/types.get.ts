import { listLeaveTypes } from '../../../../core/leave/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'leave:read' })
  const data = await listLeaveTypes(getAdminClient(), ctx.workspaceId)
  return { data }
})
