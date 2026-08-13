import { upsertCustomField } from '../../../../../core/staff/profile.mjs'
import { listCustomFields } from '../../../../../core/staff/profile.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const id = getRouterParam(event, 'id')
  const body = await readBody(event) || {}
  const fields = await listCustomFields(getAdminClient(), ctx.workspaceId, { includeInactive: true })
  const existing = fields.find((f: any) => f.id === id || f.key === id)
  if (!existing) throw apiError(404, `No custom field "${id}". Built-in fields cannot be edited this way.`)
  try {
    const data = await upsertCustomField(getAdminClient(), ctx.workspaceId, { ...body, key: existing.key }, {
      workspace_id: ctx.workspaceId,
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    })
    return { data }
  } catch (err: any) {
    throw apiError(400, err?.message || 'Could not update field')
  }
})
