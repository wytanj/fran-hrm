import test from 'node:test'
import assert from 'node:assert/strict'
import {
  BUILT_IN_BY_KEY, coerceFieldValue, isReservedFieldKey, pickCatalogInput, residencyLabel,
  serializeCustomValue, parseCustomValue, validateCustomFieldDef, canSeeSensitivity,
} from '../core/staff/fields.mjs'
import { wouldCreateStaffCycle } from '../core/org/query.mjs'
import { canSeeSensitiveFields, defaultAvailabilityRequired } from '../core/staff/profile.mjs'
import { DEFAULT_ROLE_MATRIX, SCOPES } from '../core/permissions/catalog.mjs'

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

test('availability_required is a read-only employment field', () => {
  const f = BUILT_IN_BY_KEY.availability_required
  assert.ok(f)
  assert.equal(f.writable, false)
  assert.equal(f.group, 'employment')
  assert.equal(f.type, 'boolean')
  assert.equal(isReservedFieldKey('availability_required'), true)
})

test('create-time availability_required default follows employment_type', () => {
  assert.equal(defaultAvailabilityRequired('full_time'), false)
  assert.equal(defaultAvailabilityRequired('part_time'), true)
  assert.equal(defaultAvailabilityRequired('contractor'), true)
  assert.equal(defaultAvailabilityRequired(undefined), true)
})

test('staff:availability_flag is a store/area manager carve-out, not supervisor', () => {
  assert.ok(SCOPES.some((s) => s.scope === 'staff:availability_flag'))
  assert.ok(DEFAULT_ROLE_MATRIX.store_manager.includes('staff:availability_flag'))
  assert.ok(DEFAULT_ROLE_MATRIX.area_manager.includes('staff:availability_flag'))
  assert.ok(DEFAULT_ROLE_MATRIX.hq_admin.includes('staff:availability_flag'))
  assert.equal(DEFAULT_ROLE_MATRIX.supervisor.includes('staff:availability_flag'), false)
  assert.equal(DEFAULT_ROLE_MATRIX.staff.includes('staff:availability_flag'), false)
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
