// GET /api/pay/:token/month?month=YYYY-MM — month earnings JSON (fran-bird shape).
// @ts-ignore .mjs
import { payPortalMonth } from '../../../../core/payroll/payPortal.mjs'

export default defineEventHandler(async (event) => {
  const token = String(getRouterParam(event, 'token') || '')
  const q = getQuery(event)
  const month = String(q.month || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) throw apiError(400, 'Query month=YYYY-MM is required.')
  const db = getAdminClient()
  const gateSettings = await (async () => {
    // @ts-ignore .mjs
    const { resolvePayPortalStaff } = await import('../../../../core/payroll/payPortal.mjs')
    const gate = await resolvePayPortalStaff(db, token)
    if (!gate) return null
    const settings = await getWorkspaceSettings(gate.workspace_id)
    return { gate, settings }
  })()
  if (!gateSettings) throw apiError(404, 'Pay portal link is invalid or has been revoked.')
  const data = await payPortalMonth(db, token, month, { settings: gateSettings.settings })
  if (!data) throw apiError(404, 'Pay portal link is invalid or has been revoked.')
  return { data }
})
