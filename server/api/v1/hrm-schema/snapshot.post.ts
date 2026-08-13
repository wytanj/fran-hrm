import { presentVersion, publishVersion, snapshotCurrent } from '../../../../core/hrm-schema/store.mjs'
import { readGitMeta } from '../../../../core/hrm-schema/git.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'hrm_schema:write' })
  const body = await readBody(event).catch(() => ({})) || {}
  const actor = {
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.kind === 'session' ? ctx.actorId : null,
    actor_name: ctx.actorName,
    source_type: ctx.sourceType,
  }
  try {
    const { row, created } = await snapshotCurrent(getAdminClient(), ctx.workspaceId, {
      git: readGitMeta(),
      actor,
    })
    let published = row
    if (body.publish && !row.in_force) {
      published = await publishVersion(getAdminClient(), ctx.workspaceId, row.id, actor)
    }
    return {
      data: presentVersion(published),
      created,
      note: created
        ? `Snapshotted version ${row.version}.${published.in_force ? ' It is now in force.' : ' Publish it to put it in force.'}`
        : `Already have this document as version ${row.version}.`,
    }
  } catch (err: any) {
    throw apiError(400, err?.message || 'Could not snapshot the schema')
  }
})
