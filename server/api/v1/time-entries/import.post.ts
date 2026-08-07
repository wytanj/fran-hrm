import { recordAudit } from '../../../../core/audit/record.mjs'
import { assertDate, sgTimestamp } from '../../../utils/dates'
import { assertNotLocked } from '../../../utils/payrollLock'

// Downtime fallback: when the system was unusable, the supervisor/SM records
// times on the offline sheet and uploads it here. Accepts CSV text with
// header: employee_code,work_date,clock_in,clock_out,break_minutes,store_code
// or a pre-parsed rows[] array of the same fields.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'attendance:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  let rows: any[] = []
  if (Array.isArray(body?.rows)) {
    rows = body.rows
  } else if (typeof body?.csv === 'string') {
    const lines = body.csv.split(/\r?\n/).map((l: string) => l.trim()).filter(Boolean)
    if (lines.length < 2) throw apiError(400, 'CSV needs a header row and at least one data row')
    const headers = lines[0].split(',').map((h: string) => h.trim().toLowerCase())
    rows = lines.slice(1).map((line: string) => {
      const cells = line.split(',').map((c: string) => c.trim())
      return Object.fromEntries(headers.map((h: string, i: number) => [h, cells[i] ?? '']))
    })
  }
  if (!rows.length) throw apiError(400, 'Provide rows[] or csv text')

  const { data: stores } = await db.from('stores').select('id, code').eq('workspace_id', ctx.workspaceId)
  const storeByCode = new Map((stores || []).map((s: any) => [s.code.toUpperCase(), s.id]))
  const { data: staff } = await db.from('staff').select('id, employee_code').eq('workspace_id', ctx.workspaceId)
  const staffByCode = new Map((staff || []).map((s: any) => [s.employee_code.toUpperCase(), s.id]))

  const results: any[] = []
  let imported = 0
  for (const [i, r] of rows.entries()) {
    try {
      const staffId = staffByCode.get(String(r.employee_code || '').toUpperCase())
      if (!staffId) throw new Error(`Unknown employee_code "${r.employee_code}"`)
      const storeId = storeByCode.get(String(r.store_code || '').toUpperCase())
      if (!storeId) throw new Error(`Unknown store_code "${r.store_code}"`)
      const workDate = assertDate(r.work_date, 'work_date')
      await assertNotLocked(ctx.workspaceId, workDate)
      if (!/^\d{2}:\d{2}$/.test(r.clock_in) || !/^\d{2}:\d{2}$/.test(r.clock_out)) {
        throw new Error('clock_in/clock_out must be HH:MM (SGT)')
      }
      const clockIn = sgTimestamp(workDate, r.clock_in)
      const clockOut = sgTimestamp(workDate, r.clock_out)

      const { data: entry, error } = await db.from('time_entries').insert({
        workspace_id: ctx.workspaceId,
        store_id: storeId,
        staff_id: staffId,
        work_date: workDate,
        clock_in_at: clockIn,
        clock_out_at: clockOut,
        break_minutes: Math.max(0, Number(r.break_minutes) || 0),
        source: 'import',
        status: 'closed',
        metadata: { imported_row: i + 1 },
      }).select().single()
      if (error) throw new Error(error.message)

      for (const [type, at] of [['clock_in', clockIn], ['clock_out', clockOut]] as const) {
        await db.from('clock_events').insert({
          workspace_id: ctx.workspaceId, store_id: storeId, staff_id: staffId,
          type, at, method: 'import',
          recorded_by: ctx.kind === 'session' ? ctx.staff.id : null,
        })
      }
      imported += 1
      results.push({ row: i + 1, ok: true, time_entry_id: entry.id })
    } catch (err: any) {
      results.push({ row: i + 1, ok: false, error: err.statusMessage || err.message })
    }
  }

  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'time_entries', operation: 'ACTION',
    metadata: { action: 'offline_import', rows: rows.length, imported },
  })
  return { imported, failed: rows.length - imported, results }
})
