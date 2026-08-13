import { getVersion, publishVersion, presentVersion } from '../../../../core/hrm-schema/store.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'hrm_schema:write' })
  const body = await readBody(event) || {}
  const ref = body.version_id || body.version
  if (ref == null || ref === '') throw apiError(400, 'version_id is required')
  const found = await getVersion(getAdminClient(), ctx.workspaceId, ref)
  if (!found) throw apiError(404, 'No schema version with that id or number')
  try {
    const row = await publishVersion(getAdminClient(), ctx.workspaceId, found.id, {
      actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.kind === 'session' ? ctx.actorId : null,
      actor_name: ctx.actorName,
      source_type: ctx.sourceType,
    })
    return {
      data: presentVersion(row),
      note: `Version ${row.version} is now in force.`,
    }
  } catch (err: any) {
    throw apiError(400, err?.message || 'Could not publish that version')
  }
})
