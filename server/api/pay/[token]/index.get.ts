// GET /api/pay/:token — staff pay-portal snapshot (magic link, no session).
// @ts-ignore .mjs
import { payPortalSnapshot } from '../../../../core/payroll/payPortal.mjs'

export default defineEventHandler(async (event) => {
  const token = String(getRouterParam(event, 'token') || '')
  const db = getAdminClient()
  const snap = await payPortalSnapshot(db, token)
  if (!snap) throw apiError(404, 'Pay portal link is invalid or has been revoked.')
  return { data: snap }
})
