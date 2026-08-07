export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'payroll:lock' })
  const db = getAdminClient()
  const { data, error } = await db
    .from('pay_periods')
    .select('*, approver:approved_by(display_name), locker:locked_by(display_name)')
    .eq('workspace_id', ctx.workspaceId)
    .order('start_date', { ascending: false })
    .limit(24)
  if (error) throw apiError(500, error.message)
  return { data: data || [] }
})
