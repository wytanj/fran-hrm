export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const db = getAdminClient()
  const { data, error } = await db
    .from('shift_templates')
    .select('id, store_id, name, start_time, end_time, break_minutes, job_code')
    .eq('workspace_id', ctx.workspaceId)
    .eq('is_active', true)
    .order('start_time')
  if (error) throw apiError(500, error.message)
  return { data: data || [] }
})
