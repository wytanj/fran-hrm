// Payroll lock guard: once a pay period is locked, its timesheets are
// read-only. Corrections found after lock post as dated adjustments in the
// next period — mutations against locked dates are refused here.
import { getAdminClient } from './supabase'

export async function assertNotLocked(workspaceId: string, workDate: string) {
  const db = getAdminClient()
  const { data } = await db
    .from('pay_periods')
    .select('id, start_date, end_date, status')
    .eq('workspace_id', workspaceId)
    .eq('status', 'locked')
    .lte('start_date', workDate)
    .gte('end_date', workDate)
    .maybeSingle()
  if (data) {
    throw apiError(423, `Pay period ${data.start_date} – ${data.end_date} is locked for payroll. Post a dated adjustment in the next period instead (reopening requires area_manager/hq_admin).`)
  }
}
