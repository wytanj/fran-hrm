import test from 'node:test'
import assert from 'node:assert/strict'
import { validateTemplateInput } from '../core/roster/templates.mjs'

test('name is required and trimmed', () => {
  assert.throws(() => validateTemplateInput({ start: '09:00', end: '14:00' }), /name is required/)
  assert.throws(() => validateTemplateInput({ name: '   ', start: '09:00', end: '14:00' }), /name is required/)
  const v = validateTemplateInput({ name: '  Holiday 3h  ', start: '10:00', end: '13:00' })
  assert.equal(v.name, 'Holiday 3h')
})

test('parses loose times and start_time/end_time aliases', () => {
  const a = validateTemplateInput({ name: 'A', start: '9:30', end: '18:30' })
  assert.equal(a.start, '09:30')
  assert.equal(a.end, '18:30')
  const b = validateTemplateInput({ name: 'A', start_time: '12:00', end_time: '21:00' })
  assert.equal(b.start, '12:00')
  assert.equal(b.end, '21:00')
})

test('rejects missing or unparseable times', () => {
  assert.throws(() => validateTemplateInput({ name: 'A' }), /start is required/)
  assert.throws(() => validateTemplateInput({ name: 'A', start: '09:00' }), /end is required/)
  assert.throws(() => validateTemplateInput({ name: 'A', start: '25:00', end: '13:00' }), /not a time/)
  assert.throws(() => validateTemplateInput({ name: 'A', start: '09:00', end: '99:99' }), /not a time/)
})

test('overnight and equal times are rejected with the constraints wording', () => {
  assert.throws(
    () => validateTemplateInput({ name: 'Night', start: '22:00', end: '06:00' }),
    /end \(06:00\) must be after start \(22:00\)\. Overnight shifts are not supported yet\./,
  )
  assert.throws(
    () => validateTemplateInput({ name: 'Zero', start: '10:00', end: '10:00' }),
    /Overnight shifts are not supported yet/,
  )
})

test('break_minutes defaults to 60 on create and keeps existing on update', () => {
  const created = validateTemplateInput({ name: 'A', start: '09:00', end: '14:00' })
  assert.equal(created.break_minutes, 60)
  const kept = validateTemplateInput(
    { name: 'A', start: '09:00', end: '14:00' },
    { existing: { name: 'A', start_time: '09:00', end_time: '14:00', break_minutes: 30 } },
  )
  assert.equal(kept.break_minutes, 30)
  const zero = validateTemplateInput({ name: 'A', start: '09:00', end: '14:00', break_minutes: 0 })
  assert.equal(zero.break_minutes, 0)
  assert.throws(
    () => validateTemplateInput({ name: 'A', start: '09:00', end: '14:00', break_minutes: -5 }),
    /break_minutes must be a non-negative integer/,
  )
  assert.throws(
    () => validateTemplateInput({ name: 'A', start: '09:00', end: '14:00', break_minutes: 1.5 }),
    /break_minutes must be a non-negative integer/,
  )
})

test('update keeps omitted start/end/name from the existing row', () => {
  const v = validateTemplateInput(
    { name: 'Renamed' },
    { existing: { name: 'Opening', start_time: '09:30:00', end_time: '18:30:00', break_minutes: 60, store_id: null } },
  )
  assert.equal(v.name, 'Renamed')
  assert.equal(v.start, '09:30')
  assert.equal(v.end, '18:30')
  assert.equal(v.break_minutes, 60)
  assert.equal(v.store_id, undefined)
})

test('store_id null/empty is shared; omitted on create is shared', () => {
  const created = validateTemplateInput({ name: 'A', start: '09:00', end: '14:00' })
  assert.equal(created.store_id, null)
  const cleared = validateTemplateInput(
    { name: 'A', start: '09:00', end: '14:00', store_id: '' },
    { existing: { name: 'A', start_time: '09:00', end_time: '14:00', store_id: 'abc' } },
  )
  assert.equal(cleared.store_id, null)
})
