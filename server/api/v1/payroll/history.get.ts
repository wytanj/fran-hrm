// Control plane: the payroll-settings change log (who changed what, when, from
// where). payroll:settings (finance/HQ).
// @ts-ignore .mjs shared module
import { payrollSettingsHistory } from '../../../../core/payroll/settings.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'payroll:settings' })
  const db = getAdminClient()
  const events = await payrollSettingsHistory(db, ctx.workspaceId)
  return { data: events, total: events.length }
})
