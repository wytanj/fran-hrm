import test from 'node:test'
import assert from 'node:assert/strict'
import {
  addDays, mondayOf, addMonths, startOfMonth, endOfMonth, todaySG,
  eachDate, monthWeeks, visibleRange, stepAnchor, navWindow, clampDate,
  canStep, formatDayShort, formatRangeLabel,
} from '../app/utils/calendarDates.ts'

test('addDays matches the server util (UTC date arithmetic)', () => {
  assert.equal(addDays('2026-08-24', 1), '2026-08-25')
  assert.equal(addDays('2026-08-24', -7), '2026-08-17')
  assert.equal(addDays('2026-12-31', 1), '2027-01-01')
  assert.equal(addDays('2026-03-01', -1), '2026-02-28')
})

test('mondayOf snaps any day onto that week\'s Monday', () => {
  assert.equal(mondayOf('2026-08-24'), '2026-08-24') // Monday
  assert.equal(mondayOf('2026-08-26'), '2026-08-24') // Wednesday
  assert.equal(mondayOf('2026-08-30'), '2026-08-24') // Sunday
  assert.equal(mondayOf('2026-01-01'), '2025-12-29')
})

test('addMonths clamps to the last day of the target month', () => {
  assert.equal(addMonths('2026-08-24', 1), '2026-09-24')
  assert.equal(addMonths('2026-08-24', -12), '2025-08-24')
  assert.equal(addMonths('2026-08-24', 12), '2027-08-24')
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28')
  assert.equal(addMonths('2024-01-31', 1), '2024-02-29')
  assert.equal(addMonths('2026-03-31', -1), '2026-02-28')
})

test('startOfMonth / endOfMonth', () => {
  assert.equal(startOfMonth('2026-08-24'), '2026-08-01')
  assert.equal(endOfMonth('2026-08-24'), '2026-08-31')
  assert.equal(endOfMonth('2026-02-01'), '2026-02-28')
  assert.equal(endOfMonth('2028-02-10'), '2028-02-29')
})

test('todaySG is the UTC+8 calendar date', () => {
  assert.equal(todaySG(), new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10))
  assert.match(todaySG(), /^\d{4}-\d{2}-\d{2}$/)
})

test('visibleRange: day / week (Mon–Sun) / month', () => {
  assert.deepEqual(visibleRange('day', '2026-08-26'), { start: '2026-08-26', end: '2026-08-26' })
  assert.deepEqual(visibleRange('week', '2026-08-26'), { start: '2026-08-24', end: '2026-08-30' })
  assert.deepEqual(visibleRange('month', '2026-08-26'), { start: '2026-08-01', end: '2026-08-31' })
})

test('week label matches roster.vue\'s original format (en dash, no year)', () => {
  assert.equal(formatDayShort('2026-08-24'), '24 Aug')
  assert.equal(formatRangeLabel('week', '2026-08-24', '2026-08-30'), '24 Aug – 30 Aug')
  assert.equal(formatRangeLabel('month', '2026-08-01', '2026-08-31'), 'August 2026')
  assert.match(formatRangeLabel('day', '2026-08-24', '2026-08-24'), /Mon/)
  assert.match(formatRangeLabel('day', '2026-08-24', '2026-08-24'), /24 Aug/)
})

test('nav window is ±12 months on today, inclusive', () => {
  const { min, max } = navWindow('2026-08-24')
  assert.equal(min, '2025-08-24')
  assert.equal(max, '2027-08-24')
  assert.equal(clampDate('2024-01-01', min, max), min)
  assert.equal(clampDate('2028-01-01', min, max), max)
  assert.equal(clampDate('2026-08-24', min, max), '2026-08-24')
})

test('canStep clamps the anchor, so a straddling week/month is still reachable', () => {
  const min = '2025-08-24' // Sunday
  const max = '2027-08-24' // Tuesday
  // Week containing minDate (Mon 18 – Sun 24 Aug 2025) is reachable via anchor=min.
  assert.deepEqual(visibleRange('week', min), { start: '2025-08-18', end: '2025-08-24' })
  assert.equal(canStep('week', min, -1, min, max), false)
  assert.equal(canStep('week', min, 1, min, max), true)
  // Month containing maxDate (Aug 2027, which runs past max) is reachable.
  assert.deepEqual(visibleRange('month', max), { start: '2027-08-01', end: '2027-08-31' })
  assert.equal(canStep('month', max, 1, min, max), false)
  assert.equal(canStep('day', min, -1, min, max), false)
  assert.equal(canStep('day', max, 1, min, max), false)
  assert.equal(canStep('day', '2026-08-24', 1, min, max), true)
})

test('stepAnchor moves by one unit of the current mode', () => {
  assert.equal(stepAnchor('day', '2026-08-24', 1), '2026-08-25')
  assert.equal(stepAnchor('week', '2026-08-24', 1), '2026-08-31')
  assert.equal(stepAnchor('week', '2026-08-24', -1), '2026-08-17')
  assert.equal(stepAnchor('month', '2026-08-24', 1), '2026-09-24')
})

test('monthWeeks is Monday-start and covers the whole month', () => {
  const weeks = monthWeeks('2026-08-24')
  assert.equal(weeks[0][0], mondayOf('2026-08-01'))
  assert.equal(weeks[0][0], '2026-07-27') // Aug 2026 starts Saturday
  assert.equal(weeks.at(-1).at(-1), '2026-09-06') // month ends Monday, pad to Sunday
  assert.ok(weeks.every((w) => w.length === 7))
  assert.ok(weeks.flat().includes('2026-08-01'))
  assert.ok(weeks.flat().includes('2026-08-31'))
})

test('eachDate is inclusive', () => {
  assert.deepEqual(eachDate('2026-08-24', '2026-08-26'), ['2026-08-24', '2026-08-25', '2026-08-26'])
  assert.deepEqual(eachDate('2026-08-24', '2026-08-23'), [])
})
