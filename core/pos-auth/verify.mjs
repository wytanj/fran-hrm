import { assertPosPinFormat, comparePosPin, isPinExpired } from './pin.mjs'
import { recordPosAuthEvent } from './audit.mjs'

/**
 * POS → HRM verify. Mutates lockout counters. Returns staff summary or throws
 * plain Error with statusCode.
 */
export async function verifyPosPin(db, {
  workspaceId,
  employeeCode,
  pin,
  storeCode = null,
  registerId = null,
  deviceToken = null,
}) {
  const code = String(employeeCode || '').trim().toUpperCase()
  if (!code) {
    const err = new Error('employee_code is required')
    err.statusCode = 400
    throw err
  }

  let pinOk = null
  try {
    pinOk = assertPosPinFormat(pin)
  } catch (e) {
    await recordPosAuthEvent(db, {
      workspace_id: workspaceId,
      event_type: 'unlock_fail',
      employee_code: code,
      store_code: storeCode,
      register_id: registerId,
      device_token: deviceToken,
      detail: { reason: 'pin_format' },
    }).catch(() => {})
    throw e
  }

  const { data: staff, error } = await db
    .from('staff')
    .select('id, workspace_id, employee_code, display_name, role, employment_type, employment_status, home_store_id, pos_access_enabled, pin_hash, pin_expires_at, failed_attempts, locked_until')
    .eq('workspace_id', workspaceId)
    .eq('employee_code', code)
    .maybeSingle()
  if (error) {
    const err = new Error(error.message)
    err.statusCode = 500
    throw err
  }

  const fail = async (reason, status = 401, message = 'Invalid employee code or PIN') => {
    await recordPosAuthEvent(db, {
      workspace_id: workspaceId,
      event_type: 'unlock_fail',
      staff_id: staff?.id,
      employee_code: code,
      store_code: storeCode,
      register_id: registerId,
      device_token: deviceToken,
      detail: { reason },
    }).catch(() => {})
    const err = new Error(message)
    err.statusCode = status
    err.reason = reason
    throw err
  }

  if (!staff || staff.employment_status !== 'active') await fail('inactive')
  if (!staff.pos_access_enabled) await fail('pos_access_disabled', 403, 'POS access disabled')
  if (!staff.pin_hash) await fail('no_pin')
  if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
    await fail('locked', 423, 'Account locked after repeated failed attempts. Try again in 15 minutes.')
  }
  if (isPinExpired(staff)) {
    await fail('pin_expired', 403, 'PIN expired — ask a manager to re-approve POS access')
  }

  if (!comparePosPin(pinOk, staff.pin_hash)) {
    const attempts = (staff.failed_attempts || 0) + 1
    await db.from('staff').update({
      failed_attempts: attempts,
      locked_until: attempts >= 5 ? new Date(Date.now() + 15 * 60000).toISOString() : staff.locked_until,
    }).eq('id', staff.id)
    await fail('bad_pin')
  }

  await db.from('staff').update({ failed_attempts: 0, locked_until: null }).eq('id', staff.id)

  let storeCodes = []
  const { data: assigns } = await db
    .from('staff_store_assignments')
    .select('store:store_id(code)')
    .eq('staff_id', staff.id)
  storeCodes = (assigns || []).map((a) => a.store?.code).filter(Boolean)
  if (staff.home_store_id) {
    const { data: home } = await db.from('stores').select('code').eq('id', staff.home_store_id).maybeSingle()
    if (home?.code && !storeCodes.includes(home.code)) storeCodes.push(home.code)
  }

  if (storeCode && storeCodes.length && !storeCodes.includes(String(storeCode).toUpperCase()) && !storeCodes.includes(storeCode)) {
    // Soft eligibility in P0: allow if no assignments; reject only when assignments exist and miss.
    // Float staff = P1. If they have assignments and store doesn't match → fail.
    const upper = storeCodes.map((c) => String(c).toUpperCase())
    if (!upper.includes(String(storeCode).toUpperCase())) {
      await fail('store_mismatch', 403, 'Staff not eligible for this store')
    }
  }

  await recordPosAuthEvent(db, {
    workspace_id: workspaceId,
    event_type: 'unlock_ok',
    staff_id: staff.id,
    employee_code: code,
    store_code: storeCode,
    register_id: registerId,
    device_token: deviceToken,
    detail: {},
  })

  return {
    staff: {
      id: staff.id,
      employee_code: staff.employee_code,
      display_name: staff.display_name,
      role: staff.role,
      employment_type: staff.employment_type,
      home_store_id: staff.home_store_id,
      pos_access_enabled: true,
      pin_expires_at: staff.pin_expires_at,
      store_codes: storeCodes,
    },
  }
}
