import QRCode from 'qrcode'
import { mintStaffClockToken } from '../../../utils/staffQr'

// The staff member's own rotating check-in QR (reverse-scan flow). They show
// it; a supervisor's scanner reads it. Short-lived, self-service — any signed-in
// staff member can mint their own; it carries only their identity.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (ctx.kind !== 'session') throw apiError(400, 'A staff sign-in is required to show a check-in QR.')

  const { token, expires_at, ttl_ms } = mintStaffClockToken(ctx.staff.id)
  const svg = await QRCode.toString(token, { type: 'svg', margin: 1, width: 300 })
  return {
    data: {
      token,
      expires_at,
      ttl_ms,
      staff: { display_name: ctx.staff.display_name, employee_code: ctx.staff.employee_code },
      svg,
    },
  }
})
