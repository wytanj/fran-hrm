// Roster spreadsheet import.
//
// One endpoint, two steps, chosen by `step`:
//   'preview' (default) — parse, guess/apply a mapping, dry-run, stage a batch
//   'commit'            — turn a previewed batch into draft roster(s)
//
// CSV/TSV text is posted as a JSON field rather than multipart: it is what a
// Sheets copy-paste produces, what an agent can send, and it keeps the whole
// path free of file handling.
import { recordAudit } from '../../../../core/audit/record.mjs'
// @ts-ignore .mjs shared module
import { importPreview, importCommit } from '../../../../core/roster/intake.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const body = await readBody(event)
  const db = getAdminClient()
  const actor = {
    kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    staffId: ctx.kind === 'session' ? ctx.staff.id : null,
    name: ctx.actorName,
  }
  const step = String(body?.step || 'preview')

  if (step === 'commit') {
    const batchId = String(body?.batch_id || '')
    if (!batchId) throw apiError(400, 'batch_id is required to commit')
    try {
      const result = await importCommit(db, ctx.workspaceId, batchId, {
        actor, replace: !!body.replace, saveMappingAs: body.save_mapping_as || null,
      })
      await recordAudit(db, {
        workspace_id: ctx.workspaceId,
        actor_kind: actor.kind, actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
        object_type: 'roster_import_batches', entity_id: batchId, operation: 'ACTION',
        metadata: { action: 'commit_roster_import', imported: result.imported, skipped: result.skipped },
      })
      return { data: result }
    } catch (err: any) {
      throw apiError(422, err.message)
    }
  }

  const text = typeof body?.text === 'string' ? body.text : (typeof body?.csv === 'string' ? body.csv : '')
  if (!text.trim()) {
    throw apiError(400, 'Provide the sheet as `text` (CSV or tab-separated — a paste from Google Sheets works).')
  }

  try {
    const result = await importPreview(db, ctx.workspaceId, {
      text,
      storeId: body.store_id || (ctx.kind === 'session' ? ctx.staff.home_store_id : null),
      weekStart: body.week_start || null,
      mapping: body.mapping || null,
      layout: body.layout || null,
      valueAliases: body.value_aliases || null,
      mappingId: body.mapping_id || null,
      sourceName: body.source_name || null,
      actor,
    })
    return { data: result }
  } catch (err: any) {
    throw apiError(422, err.message)
  }
})
