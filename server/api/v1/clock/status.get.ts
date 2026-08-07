import { sgToday } from '../../../utils/dates'

// My clock state today: open entry, running break, today's published shift.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (ctx.kind !== 'session') throw apiError(400, 'Clock status is a staff-session endpoint')
  const db = getAdminClient()
  const today = sgToday()

  const [{ data: entries }, { data: shifts }] = await Promise.all([
    db.from('time_entries').select('*').eq('staff_id', ctx.staff.id).eq('work_date', today).order('created_at', { ascending: false }),
    db.from('shifts').select('*, roster:roster_id(status), store:store_id(code, name)')
      .eq('staff_id', ctx.staff.id).eq('work_date', today).neq('status', 'cancelled'),
  ])
  const open = (entries || []).find((e: any) => !e.clock_out_at) || null
  const shift = (shifts || []).find((s: any) => s.roster?.status === 'published') || null

  return {
    data: {
      today,
      open_entry: open,
      on_break: !!open?.break_open_at,
      entries_today: entries || [],
      shift: shift ? {
        id: shift.id, start_at: shift.start_at, end_at: shift.end_at,
        break_minutes: shift.break_minutes, store: shift.store, job_code: shift.job_code,
      } : null,
    },
  }
})
