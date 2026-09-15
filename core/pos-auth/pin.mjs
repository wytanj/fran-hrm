import { randomInt } from 'node:crypto'
import bcrypt from 'bcryptjs'

export const POS_PIN_DIGITS = 8
export const POS_PIN_TTL_MONTHS = 12

export function generatePosPin() {
  // 8 digits, allow leading zeros
  let s = ''
  for (let i = 0; i < POS_PIN_DIGITS; i++) s += String(randomInt(0, 10))
  return s
}

export function assertPosPinFormat(pin) {
  const p = String(pin || '')
  if (!new RegExp(`^\\d{${POS_PIN_DIGITS}}$`).test(p)) {
    const err = new Error(`PIN must be exactly ${POS_PIN_DIGITS} digits`)
    err.statusCode = 400
    throw err
  }
  return p
}

export function hashPosPin(pin) {
  return bcrypt.hashSync(assertPosPinFormat(pin), 10)
}

export function pinExpiryFrom(now = new Date(), months = POS_PIN_TTL_MONTHS) {
  const d = new Date(now)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

export function isPinExpired(staff, now = new Date()) {
  if (!staff?.pin_expires_at) return false
  return new Date(staff.pin_expires_at) <= now
}

export function comparePosPin(pin, pinHash) {
  if (!pinHash) return false
  try {
    return bcrypt.compareSync(String(pin), pinHash)
  } catch {
    return false
  }
}
