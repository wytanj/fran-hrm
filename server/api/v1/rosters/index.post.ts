import { recordAudit } from '../../../../core/audit/record.mjs'
import { assertDate, mondayOf, addDays } from '../../../utils/dates'

// Create a draft roster, optionally copying shifts from a prior week
// (the "template/prior week" starting point from the spec).
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const storeId = String(body?.store_id || '')
  const weekStart = mondayOf(assertDate(body?.week_start, 'week_start'))
  if (!storeId) throw apiError(400, 'store_id is required')

  const { data: roster, error } = await db
    .from('rosters')
    .insert({ workspace_id: ctx.workspaceId, store_id: storeId, week_start: weekStart, notes: body.notes || null })
    .select()
    .single()
  if (error) {
    if (error.code === '23505') throw apiError(409, `A roster for ${weekStart} already exists for this store`)
    throw apiError(400, error.message)
  }

  let copied = 0
  if (body.copy_from_week) {
    const sourceWeek = mondayOf(assertDate(body.copy_from_week, 'copy_from_week'))
    const { data: source } = await db
      .from('rosters').select('id').eq('workspace_id', ctx.workspaceId)
      .eq('store_id', storeId).eq('week_start', sourceWeek).maybeSingle()
    if (source) {
      const { data: shifts } = await db.from('shifts').select('*').eq('roster_id', source.id).neq('status', 'cancelled')
      const offsetDays = Math.round((new Date(weekStart).getTime() - new Date(sourceWeek).getTime()) / 86400000)
      for (const sh of shifts || []) {
        const { error: insErr } = await db.from('shifts').insert({
          workspace_id: ctx.workspaceId,
          roster_id: roster.id,
          store_id: storeId,
          staff_id: sh.staff_id,
          work_date: addDays(sh.work_date, offsetDays),
          start_at: new Date(new Date(sh.start_at).getTime() + offsetDays * 86400000).toISOString(),
          end_at: new Date(new Date(sh.end_at).getTime() + offsetDays * 86400000).toISOString(),
          break_minutes: sh.break_minutes,
          job_code: sh.job_code,
          template_id: sh.template_id,
        })
        if (!insErr) copied += 1
      }
    }
  }

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'rosters', entity_id: roster.id, operation: 'INSERT',
    after_data: roster, metadata: { copied_shifts: copied },
  })
  return { data: roster, copied_shifts: copied }
})
