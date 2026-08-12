// Create a zone. zones:write (store managers and above).
import { recordAudit } from '../../../../core/audit/record.mjs'
// @ts-ignore .mjs shared module
import { createZone } from '../../../../core/zones/query.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'zones:write' })
  const body = await readBody(event)
  const db = getAdminClient()
  const storeId = String(body?.store_id || '')
  if (!storeId) throw apiError(400, 'store_id is required')

  const zone = await createZone(db, ctx.workspaceId, storeId, body, {
    actorStaffId: ctx.kind === 'session' ? ctx.staff.id : null,
  }).catch((err: any) => { throw apiError(422, err.message) })

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'store_zones', entity_id: zone.id, operation: 'INSERT',
    metadata: { action: 'create_zone', store_id: storeId, name: zone.name },
  })
  return { data: zone }
})
