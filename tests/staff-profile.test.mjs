import test from 'node:test'
import assert from 'node:assert/strict'
import {
  coerceFieldValue, isReservedFieldKey, pickCatalogInput, residencyLabel,
  serializeCustomValue, parseCustomValue, validateCustomFieldDef, canSeeSensitivity,
} from '../core/staff/fields.mjs'
import { wouldCreateStaffCycle } from '../core/org/query.mjs'
import { canSeeSensitiveFields } from '../core/staff/profile.mjs'

test('citizenship labels', () => {
  assert.equal(residencyLabel('citizen'), 'Singaporean')
  assert.equal(residencyLabel('pr'), 'PR')
  assert.equal(residencyLabel('foreigner'), 'Foreigner')
})

test('reserved keys cannot be custom fields', () => {
  assert.equal(isReservedFieldKey('monthly_salary_cents'), true)
  assert.equal(isReservedFieldKey('residency'), true)
  assert.equal(isReservedFieldKey('shirt_size'), false)
  assert.throws(() => validateCustomFieldDef({ key: 'nric', label: 'Nope' }), /built-in/i)
})

test('custom field slugs', () => {
  const def = validateCustomFieldDef({
    key: 'work_pass_expiry', label: 'Work pass expiry', field_type: 'date', sensitivity: 'pii',
  })
  assert.equal(def.key, 'work_pass_expiry')
  assert.throws(() => validateCustomFieldDef({ key: '1bad', label: 'x' }), /slug/i)
})

test('coerce money and enums', () => {
  assert.equal(coerceFieldValue({ key: 'monthly_salary_cents', type: 'money_cents' }, 550000), 550000)
  assert.equal(coerceFieldValue({ key: 'race', type: 'enum', options: [{ value: 'chinese', label: 'Chinese' }] }, 'Chinese'), 'chinese')
  assert.throws(() => coerceFieldValue({ key: 'residency', type: 'enum', options: [{ value: 'citizen', label: 'Singaporean' }] }, 'alien'))
})

test('custom value round-trip', () => {
  const field = { key: 'ok', type: 'boolean' }
  assert.equal(serializeCustomValue(field, true), 'true')
  assert.equal(parseCustomValue(field, 'true'), true)
  assert.equal(parseCustomValue(field, null), null)
})

test('pickCatalogInput accepts flat or fields bag', () => {
  const a = pickCatalogInput({ display_name: 'Ada', residency: 'pr', custom: { shirt_size: 'M' } })
  assert.equal(a.builtIn.residency, 'pr')
  assert.equal(a.custom.shirt_size, 'M')
  const b = pickCatalogInput({ fields: { race: 'malay', locker: '12' } })
  assert.equal(b.builtIn.race, 'malay')
  assert.equal(b.custom.locker, '12')
})

test('sensitivity gate', () => {
  assert.equal(canSeeSensitivity('directory', { includeSensitive: false }), true)
  assert.equal(canSeeSensitivity('pii', { includeSensitive: false }), false)
  assert.equal(canSeeSensitivity('compensation', { includeSensitive: true }), true)
  assert.equal(canSeeSensitiveFields(['staff:read']), false)
  assert.equal(canSeeSensitiveFields(['staff:write']), true)
  assert.equal(canSeeSensitiveFields(['reports:cost']), true)
  assert.equal(canSeeSensitiveFields(null), true)
})

test('staff reporting-line cycle', () => {
  const rows = [
    { id: 'a', reports_to_id: 'b' },
    { id: 'b', reports_to_id: 'c' },
    { id: 'c', reports_to_id: null },
  ]
  assert.equal(wouldCreateStaffCycle(rows, 'c', 'a'), true)
  assert.equal(wouldCreateStaffCycle(rows, 'c', 'x'), false)
  assert.equal(wouldCreateStaffCycle(rows, 'a', 'a'), true)
})
