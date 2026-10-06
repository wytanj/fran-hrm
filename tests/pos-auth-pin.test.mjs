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

test('generatePosPin is exactly 5 digits', () => {
  assert.equal(POS_PIN_DIGITS, 5)
  for (let i = 0; i < 20; i++) {
    const p = generatePosPin()
    assert.match(p, /^\d{5}$/)
  }
})

test('assertPosPinFormat rejects non-5-digit', () => {
  assert.equal(assertPosPinFormat('12345'), '12345')
  assert.equal(assertPosPinFormat('04218'), '04218')
  assert.throws(() => assertPosPinFormat('1234'), /exactly 5/)
  assert.throws(() => assertPosPinFormat('123456'), /exactly 5/)
  assert.throws(() => assertPosPinFormat('12345678'), /exactly 5/)
  assert.throws(() => assertPosPinFormat('abcde'), /exactly 5/)
})

test('hash + compare round-trip', () => {
  const pin = '04218'
  const hash = hashPosPin(pin)
  assert.ok(comparePosPin(pin, hash))
  assert.equal(comparePosPin('00000', hash), false)
})

test('pin expiry metadata', () => {
  const start = new Date('2026-09-15T00:00:00Z')
  const exp = pinExpiryFrom(start, 12)
  assert.equal(exp.toISOString().startsWith('2027-09-15'), true)
  assert.equal(isPinExpired({ pin_expires_at: '2026-01-01T00:00:00Z' }, start), true)
  assert.equal(isPinExpired({ pin_expires_at: '2027-09-15T00:00:00Z' }, start), false)
  assert.equal(isPinExpired({ pin_expires_at: null }, start), false)
})
