// Read CPF/EOR pay settings. Financial config — payroll:settings (finance/HQ).
// @ts-ignore .mjs shared module
import { getPayrollSettings } from '../../../../core/payroll/settings.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'payroll:settings' })
  const db = getAdminClient()
  return { data: await getPayrollSettings(db, ctx.workspaceId) }
})
