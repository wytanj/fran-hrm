export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'attendance:read' })
  const q = getQuery(event)
  const db = getAdminClient()

  let query = db
    .from('time_corrections')
    .select('*, staff:staff_id(employee_code, display_name), requester:requested_by(display_name), decider:decided_by(display_name)')
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (q.status) query = query.eq('status', String(q.status))
  const staffId = limitToSelf(ctx, q.staff_id ? String(q.staff_id) : null)
  if (staffId) query = query.eq('staff_id', staffId)
  else assertTeamReach(ctx, 'The full corrections queue')
  const { data, error } = await query
  if (error) throw apiError(500, error.message)
  return { data: data || [] }
})
