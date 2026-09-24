// GET /api/pay/:token/month?month=YYYY-MM — month earnings JSON (fran-bird shape).
// @ts-ignore .mjs
import { payPortalMonth, resolvePayPortalStaff, isPayPortalLiveEligible } from '../../../../core/payroll/payPortal.mjs'
// @ts-ignore .mjs
import { loadHireGates } from '../../../../core/payroll/eligibility.mjs'

export default defineEventHandler(async (event) => {
  const token = String(getRouterParam(event, 'token') || '')
  const q = getQuery(event)
  const month = String(q.month || '').slice(0, 7)
  if (!/^\d{4}-\d{2}$/.test(month)) throw apiError(400, 'Query month=YYYY-MM is required.')
  const db = getAdminClient()
  const gate = await resolvePayPortalStaff(db, token)
  if (!gate) throw apiError(404, 'Pay portal link is invalid or has been revoked.')
  const gates = gate.employment_status === 'active'
    ? await loadHireGates(db, gate.workspace_id, gate.id)
    : null
  if (!isPayPortalLiveEligible(gate, { gates })) {
    throw apiError(403, 'Month preview is only available while employed and payroll-eligible.')
  }
  const settings = await getWorkspaceSettings(gate.workspace_id)
  const data = await payPortalMonth(db, token, month, { settings })
  if (!data) throw apiError(404, 'Pay portal link is invalid or has been revoked.')
  return { data }
})