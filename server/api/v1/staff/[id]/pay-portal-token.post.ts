// POST /api/v1/staff/:id/pay-portal-token — ensure or rotate stable magic-link token.
// Body: { rotate?: boolean }
// @ts-ignore .mjs
import { ensurePayPortalToken, revokePayPortalToken } from '../../../../../core/payroll/payPortal.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const staffId = String(getRouterParam(event, 'id') || '')
  const body = await readBody(event).catch(() => ({})) as { rotate?: boolean }
  const db = getAdminClient()
  const result = body?.rotate
    ? await revokePayPortalToken(db, ctx.workspaceId, staffId)
    : await ensurePayPortalToken(db, ctx.workspaceId, staffId)
  const origin = getRequestURL(event).origin
  return {
    data: {
      token: result.token,
      url: `${origin}/pay/${result.token}`,
      rotated: !!(result as any).rotated,
      created: !!(result as any).created,
    },
  }
})
