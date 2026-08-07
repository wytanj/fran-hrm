
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const q = getQuery(event)
  const db = getAdminClient()

  let query = db
    .from('shift_swaps')
    .select(`id, status, reason, created_at, decided_at, decision_note,
      shift:shift_id(id, work_date, start_at, end_at, store_id),
      counterpart_shift:counterpart_shift_id(id, work_date, start_at, end_at),
      requester:requested_by(id, employee_code, display_name),
      counterpart:counterpart_staff_id(id, employee_code, display_name),
      decider:decided_by(display_name)`)
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (q.status) query = query.eq('status', String(q.status))
  if (ctx.kind === 'session' && !ctx.has('roster:write')) {
    query = query.or(`requested_by.eq.${ctx.staff.id},counterpart_staff_id.eq.${ctx.staff.id}`)
  }
  const { data, error } = await query
  if (error) throw apiError(500, error.message)
  return { data: data || [] }
})
