import bcrypt from 'bcryptjs'
import { createStaffRecord } from '../../../../core/staff/profile.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const body = await readBody(event) || {}
  const isDummy = !!body.is_dummy
  if (isDummy && !body.pin) body.pin = '123456'
  if (body.pin) {
    if (!/^\d{4,12}$/.test(String(body.pin))) throw apiError(400, 'PIN must be 4-12 digits')
    body.pin_hash = bcrypt.hashSync(String(body.pin), 10)
  }
  try {
    const data = await createStaffRecord(getAdminClient(), ctx.workspaceId, body, {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    })
    return { data: { ...data, can_edit: true, can_see_sensitive: true } }
  } catch (err: any) {
    throw apiError(400, err?.message || 'Could not create staff')
  }
})
