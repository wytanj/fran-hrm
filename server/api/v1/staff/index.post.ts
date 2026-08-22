import bcrypt from 'bcryptjs'
import { createStaffRecord } from '../../../../core/staff/profile.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  const body = await readBody(event) || {}
  const isDummy = !!body.is_dummy
  // Dummy staff get their own, lighter scope — a store manager can model a
  // prospective hire without full "create and edit real staff" rights.
  const needed = isDummy ? 'staff:dummy' : 'staff:write'
  if (!ctx.has(needed)) throw denied(needed, { scopes: ctx.scopes, role: ctx.role, kind: ctx.kind, name: ctx.actorName })
  // staff:dummy alone (no staff:write) must not become a privilege-escalation
  // path — a dummy could otherwise be role:hq_admin and "View as"'d for real
  // elevated scopes. Cap the assignable role at the actor's own level.
  if (!ctx.has('staff:write') && body.role && !roleAtLeast(ctx.role, body.role)) {
    throw apiError(403, `A dummy cannot be given a role senior to your own (${ctx.role}).`)
  }
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
