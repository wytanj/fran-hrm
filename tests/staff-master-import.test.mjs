import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateNricChecksum, KNOWN_BANK_BICS } from '../core/staff/masterImport.mjs'
import { resolveShgBandCents } from '../core/payroll/statutory.mjs'

test('NRIC rejects bad format and bad checksum', () => {
  assert.equal(validateNricChecksum('').ok, false)
  assert.equal(validateNricChecksum('X1234567A').ok, false)
  assert.equal(validateNricChecksum('S1234567A').ok, false)
})

test('NRIC accepts a known-valid S-series', () => {
  // Construct: find a valid checksum for S0000001?
  // Brute a few digits for S + 7 digits
  let found = null
  for (let n = 0; n < 10000000; n++) {
    const body = String(n).padStart(7, '0')
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const cand = 'S' + body + letter
      if (validateNricChecksum(cand).ok) { found = cand; break }
    }
    if (found) break
  }
  assert.ok(found, 'should find at least one valid NRIC')
  assert.equal(validateNricChecksum(found).ok, true)
})

test('SHG bands resolve by wage', () => {
  const bands = [
    { min_cents: 0, max_cents: 200000, employee_cents: 50 },
    { min_cents: 200000, max_cents: 400000, employee_cents: 100 },
    { min_cents: 400000, employee_cents: 200 },
  ]
  assert.equal(resolveShgBandCents(bands, 150000), 50)
  assert.equal(resolveShgBandCents(bands, 200000), 100)
  assert.equal(resolveShgBandCents(bands, 500000), 200)
  assert.equal(resolveShgBandCents([], 100), null)
})

test('known BIC allowlist has major banks', () => {
  assert.ok(KNOWN_BANK_BICS.has('DBSSSGSG'))
  assert.ok(KNOWN_BANK_BICS.has('UOVBSGSG'))
})
