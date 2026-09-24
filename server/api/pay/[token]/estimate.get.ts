// GET /api/pay/:token/estimate — live PT-week / FT-MTD earnings estimate.
// @ts-ignore .mjs
import { resolvePayPortalStaff, isPayPortalLiveEligible } from '../../../../core/payroll/payPortal.mjs'
// @ts-ignore .mjs
import { liveEarningsEstimate } from '../../../../core/payroll/earnings.mjs'
// @ts-ignore .mjs
import { loadHireGates } from '../../../../core/payroll/eligibility.mjs'

export default defineEventHandler(async (event) => {
  const token = String(getRouterParam(event, 'token') || '')
  const db = getAdminClient()
  const gate = await resolvePayPortalStaff(db, token)
  if (!gate) throw apiError(404, 'Pay portal link is invalid or has been revoked.')
  const gates = gate.employment_status === 'active'
    ? await loadHireGates(db, gate.workspace_id, gate.id)
    : null
  if (!isPayPortalLiveEligible(gate, { gates })) {
    throw apiError(403, 'Live estimate is only available while employed and payroll-eligible.')
  }
  const settings = await getWorkspaceSettings(gate.workspace_id)
  const estimate = await liveEarningsEstimate(db, gate.workspace_id, gate.id, { settings })
  return { data: estimate }
})