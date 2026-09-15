import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generatePosPin,
  assertPosPinFormat,
  hashPosPin,
  comparePosPin,
  pinExpiryFrom,
  isPinExpired,
  POS_PIN_DIGITS,
} from '../core/pos-auth/pin.mjs'

test('generatePosPin is exactly 8 digits', () => {
  for (let i = 0; i < 20; i++) {
    const p = generatePosPin()
    assert.match(p, new RegExp(`^\\d{${POS_PIN_DIGITS}}$`))
  }
})

test('assertPosPinFormat rejects non-8-digit', () => {
  assert.equal(assertPosPinFormat('12345678'), '12345678')
  assert.throws(() => assertPosPinFormat('1234'), /exactly 8/)
  assert.throws(() => assertPosPinFormat('123456789'), /exactly 8/)
  assert.throws(() => assertPosPinFormat('abcdefgh'), /exactly 8/)
})

test('hash + compare round-trip', () => {
  const pin = '04218765'
  const hash = hashPosPin(pin)
  assert.ok(comparePosPin(pin, hash))
  assert.equal(comparePosPin('00000000', hash), false)
})

test('pin expiry metadata', () => {
  const start = new Date('2026-09-15T00:00:00Z')
  const exp = pinExpiryFrom(start, 12)
  assert.equal(exp.toISOString().startsWith('2027-09-15'), true)
  assert.equal(isPinExpired({ pin_expires_at: '2026-01-01T00:00:00Z' }, start), true)
  assert.equal(isPinExpired({ pin_expires_at: '2027-09-15T00:00:00Z' }, start), false)
  assert.equal(isPinExpired({ pin_expires_at: null }, start), false)
})
