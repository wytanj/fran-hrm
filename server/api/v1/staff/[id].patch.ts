import bcrypt from 'bcryptjs'
import { updateStaffRecord } from '../../../../core/staff/profile.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const body = await readBody(event) || {}
  if (body.pin) {
    if (!/^\d{4,12}$/.test(String(body.pin))) throw apiError(400, 'PIN must be 4-12 digits')
    body.pin_hash = bcrypt.hashSync(String(body.pin), 10)
  }
  try {
    const data = await updateStaffRecord(getAdminClient(), ctx.workspaceId, getRouterParam(event, 'id'), body, {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    })
    return { data: { ...data, can_edit: true, can_see_sensitive: true } }
  } catch (err: any) {
    const msg = err?.message || 'Could not update staff'
    throw apiError(/loop|cannot report|must be|required|Unknown custom|No /i.test(msg) ? 400 : 400, msg)
  }
})
