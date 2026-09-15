import { verifyPosPin } from '../../../../core/pos-auth/verify.mjs'

/**
 * POS register unlock. Machine key with pos:verify (or legacy pos:sync).
 * Body: { employee_code, pin, store_code?, register_id?, device_token? }
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (!ctx.has('pos:verify') && !ctx.has('pos:sync')) {
    throw apiError(403, 'API key or session needs pos:verify (or pos:sync) to unlock a register')
  }

  const body = await readBody(event)
  try {
    const result = await verifyPosPin(getAdminClient(), {
      workspaceId: ctx.workspaceId,
      employeeCode: body?.employee_code || body?.employeeCode,
      pin: body?.pin,
      storeCode: body?.store_code || body?.storeCode || null,
      registerId: body?.register_id || body?.registerId || null,
      deviceToken: body?.device_token || body?.deviceToken || null,
    })
    return { ok: true, ...result }
  } catch (e: any) {
    throw apiError(e.statusCode || 500, e.message || 'Verify failed', { reason: e.reason })
  }
})
