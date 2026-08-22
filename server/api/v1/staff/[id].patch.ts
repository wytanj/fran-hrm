import bcrypt from 'bcryptjs'
import { updateStaffRecord } from '../../../../core/staff/profile.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  const id = getRouterParam(event, 'id')
  const db = getAdminClient()
  const { data: target } = await db.from('staff').select('id, is_dummy')
    .eq('workspace_id', ctx.workspaceId).eq('id', id).maybeSingle()
  if (!target) throw apiError(404, 'Staff not found')

  const needed = target.is_dummy ? 'staff:dummy' : 'staff:write'
  if (!ctx.has(needed)) throw denied(needed, { scopes: ctx.scopes, role: ctx.role, kind: ctx.kind, name: ctx.actorName })

  const body = await readBody(event) || {}
  // See index.post.ts: staff:dummy alone must not be a way to promote a
  // dummy to a role senior to the actor's own and then View as it.
  if (!ctx.has('staff:write') && body.role && !roleAtLeast(ctx.role, body.role)) {
    throw apiError(403, `A dummy cannot be given a role senior to your own (${ctx.role}).`)
  }
  if (body.pin) {
    if (!/^\d{4,12}$/.test(String(body.pin))) throw apiError(400, 'PIN must be 4-12 digits')
    body.pin_hash = bcrypt.hashSync(String(body.pin), 10)
  }
  try {
    const data = await updateStaffRecord(db, ctx.workspaceId, id, body, {
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
