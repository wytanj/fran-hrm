import bcrypt from 'bcryptjs'
import { generatePosPin, pinExpiryFrom, POS_PIN_DIGITS, POS_PIN_TTL_MONTHS } from '../../../../core/pos-auth/pin.mjs'
import { recordPosAuthEvent } from '../../../../core/pos-auth/audit.mjs'
import { recordAudit } from '../../../../core/audit/record.mjs'

function judgmentOk(ctx: any) {
  return ctx.has('staff:write') || ctx.has('staff:invite') || ctx.has('leave:approve') || ctx.has('pos:disable')
}

/**
 * SM / area / HQ judgment card: approve | reject | hold.
 * Approve → pos_access + 8-digit PIN + 12m expiry; one-time PIN in response.
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (!judgmentOk(ctx)) {
    throw apiError(403, 'Requires store manager / area manager / HQ judgment permission (staff:write, staff:invite, leave:approve, or pos:disable)')
  }

  const body = await readBody(event)
  const decision = String(body?.decision || '').toLowerCase()
  if (!['approve', 'reject', 'hold'].includes(decision)) {
    throw apiError(400, 'decision must be approve | reject | hold')
  }

  const db = getAdminClient()
  const ref = body?.staff_id || body?.employee_code || body?.employeeCode
  if (!ref) throw apiError(400, 'staff_id or employee_code required')

  let q = db.from('staff').select('*').eq('workspace_id', ctx.workspaceId)
  q = String(ref).includes('-') && String(ref).length > 30
    ? q.eq('id', ref)
    : q.eq('employee_code', String(ref).trim().toUpperCase())
  const { data: staff, error } = await q.maybeSingle()
  if (error) throw apiError(500, error.message)
  if (!staff) throw apiError(404, 'Staff not found')

  if (decision === 'hold') {
    await recordPosAuthEvent(db, {
      workspace_id: ctx.workspaceId,
      event_type: 'hire_hold',
      staff_id: staff.id,
      employee_code: staff.employee_code,
      actor_staff_id: ctx.kind === 'session' ? ctx.staff?.id : null,
      actor_name: ctx.actorName,
      detail: { note: body?.note || null },
    })
    return { ok: true, decision: 'hold', staff_id: staff.id }
  }

  if (decision === 'reject') {
    await db.from('staff').update({
      pos_access_enabled: false,
      updated_at: new Date().toISOString(),
    }).eq('id', staff.id)
    await recordPosAuthEvent(db, {
      workspace_id: ctx.workspaceId,
      event_type: 'hire_reject',
      staff_id: staff.id,
      employee_code: staff.employee_code,
      actor_staff_id: ctx.kind === 'session' ? ctx.staff?.id : null,
      actor_name: ctx.actorName,
      detail: { note: body?.note || null },
    })
    return { ok: true, decision: 'reject', staff_id: staff.id }
  }

  // approve
  let employeeCode = staff.employee_code
  if (!employeeCode) {
    employeeCode = `T${String(Date.now()).slice(-7)}`
  }
  const pin = generatePosPin()
  const now = new Date()
  const expires = pinExpiryFrom(now, POS_PIN_TTL_MONTHS)
  const patch = {
    employee_code: employeeCode,
    pos_access_enabled: true,
    pin_hash: bcrypt.hashSync(pin, 10),
    pin_expires_at: expires.toISOString(),
    pin_rotated_at: now.toISOString(),
    failed_attempts: 0,
    locked_until: null,
    employment_status: staff.employment_status === 'terminated' ? 'active' : staff.employment_status,
    updated_at: now.toISOString(),
  }
  const { data: updated, error: upErr } = await db.from('staff').update(patch).eq('id', staff.id).select('id, employee_code, display_name, role, pos_access_enabled, pin_expires_at').single()
  if (upErr) throw apiError(500, upErr.message)

  await recordPosAuthEvent(db, {
    workspace_id: ctx.workspaceId,
    event_type: 'hire_approve',
    staff_id: staff.id,
    employee_code: employeeCode,
    actor_staff_id: ctx.kind === 'session' ? ctx.staff?.id : null,
    actor_name: ctx.actorName,
    detail: { pin_digits: POS_PIN_DIGITS, pin_ttl_months: POS_PIN_TTL_MONTHS },
  })
  await recordAudit(db, {
    workspace_id: ctx.workspaceId,
    actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId,
    actor_name: ctx.actorName,
    source_type: ctx.sourceType,
    object_type: 'staff',
    entity_id: staff.id,
    operation: 'ACTION',
    after_data: { pos_access_enabled: true, pin_expires_at: expires.toISOString() },
    metadata: { action: 'pos_hire_approve' },
  })

  return {
    ok: true,
    decision: 'approve',
    staff: updated,
    // One-time delivery — prefer Telegram later; toast/reveal for P0.
    pin,
    pin_expires_at: expires.toISOString(),
    delivery: 'one_time_response',
    note: 'Show this PIN once to the hire (or forward via Telegram). It will not be shown again.',
  }
})
