import test from 'node:test'
import assert from 'node:assert/strict'
import { BUILT_IN_FIELDS, RESIDENCY_OPTIONS } from '../core/staff/fields.mjs'
import { INVARIANTS } from '../core/hrm-schema/invariants.mjs'
import {
  assembleSchema, buildCoreSchema, hashSchema, prettySchemaJson, renderSchemaText, stableStringify,
} from '../core/hrm-schema/build.mjs'

test('core schema is built from the live field catalog (DRY)', () => {
  const schema = buildCoreSchema()
  assert.equal(schema.id, 'fran-hrm.people')
  assert.equal(schema.staff.fields.length, BUILT_IN_FIELDS.length)
  assert.deepEqual(schema.staff.fields.map((f) => f.key), BUILT_IN_FIELDS.map((f) => f.key))
  assert.deepEqual(schema.staff.citizenship, RESIDENCY_OPTIONS)
  assert.ok(schema.invariants.length === INVARIANTS.length)
})

test('stable stringify ignores key insertion order', () => {
  assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }))
  assert.equal(hashSchema({ b: 1, a: { z: 1, y: 2 } }), hashSchema({ a: { y: 2, z: 1 }, b: 1 }))
})

test('hash changes when a field is added', () => {
  const a = hashSchema(buildCoreSchema())
  const mutated = buildCoreSchema()
  mutated.staff.fields = [...mutated.staff.fields, { key: 'extra', type: 'text' }]
  assert.notEqual(hashSchema(mutated), a)
})

test('verbose text names citizenship and the two title forms', () => {
  const text = renderSchemaText(buildCoreSchema())
  assert.match(text, /Singaporean/)
  assert.match(text, /citizen/)
  assert.match(text, /positions\.title/)
  assert.match(text, /two-title-forms|Formal/)
  assert.match(text, /monthly_salary_cents/)
})

test('assembled document includes workspace overlay without changing core hash identity of fields', () => {
  const core = buildCoreSchema()
  const full = assembleSchema(core, {
    custom_fields: [{ key: 'shirt_size', label: 'Shirt size', type: 'enum', sensitivity: 'directory', is_active: true }],
    departments: [{ key: 'retail_ops', name: 'Retail Operations' }],
    leave_types: [{ code: 'AL', name: 'Annual Leave', is_paid: true, default_days_per_year: 14, is_active: true }],
  })
  assert.equal(full.staff.fields.length, core.staff.fields.length)
  assert.equal(full.workspace.custom_fields[0].key, 'shirt_size')
  assert.match(renderSchemaText(full), /shirt_size/)
  assert.match(prettySchemaJson(full), /"shirt_size"/)
})
