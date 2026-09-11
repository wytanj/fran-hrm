import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_SCHEDULING_RULES, validateSchedulingRules, mergeSchedulingRules,
  loadSchedulingRulesFile, getSchedulingRules, reloadSchedulingRules,
  availabilityWindowFor, isDateLockedByRules, currentAvailabilityMonth, remindersDueOn,
  addMonths, monthBounds,
} from '../core/scheduling/rules.mjs'
import { parseAvailLines, handleUpdate } from '../core/telegram/handlers.mjs'
import { reminderCopy } from '../core/telegram/reminders.mjs'

const FILE = fileURLToPath(new URL('../config/scheduling_rules.json', import.meta.url))

test('config/scheduling_rules.json is valid and matches the built-in defaults (no drift)', () => {
  const fromFile = JSON.parse(readFileSync(FILE, 'utf8'))
  const { ok, errors, value } = validateSchedulingRules(fromFile)
  assert.ok(ok, errors.join('\n'))
  assert.deepEqual(value, validateSchedulingRules(DEFAULT_SCHEDULING_RULES).value)
  const loaded = loadSchedulingRulesFile({ force: true })
  assert.equal(loaded.source, 'file')
  assert.deepEqual(getSchedulingRules(), value)
  assert.deepEqual(reloadSchedulingRules(), value)
})

test('validate: coerces numeric strings, de-dupes lists, rejects bad shapes with field-named errors', () => {
  const good = validateSchedulingRules({
    ...DEFAULT_SCHEDULING_RULES,
    version: '3',
    availability: { open_day_of_prior_month: '1', lock_day_of_prior_month: '7', reminders: ['open', 'open', 'T-1d'] },
  })
  assert.ok(good.ok, good.errors.join('\n'))
  assert.equal(good.value.version, 3)
  assert.deepEqual(good.value.availability.reminders, ['open', 'T-1d'])

  const bad = validateSchedulingRules({
    ...DEFAULT_SCHEDULING_RULES,
    availability: { open_day_of_prior_month: 10, lock_day_of_prior_month: 7, reminders: ['open', 'yesterday'] },
    publish: { target_day_of_prior_month: 3, guardrails: ['leave_block', 'nope'] },
    pricing: { default_basis: 'magic', template_multipliers: { closing: -1 } },
    telegram: { pilot: 'yes', require_linked_identity: true },
  })
  assert.equal(bad.ok, false)
  assert.equal(bad.value, null)
  const text = bad.errors.join('\n')
  assert.match(text, /lock_day_of_prior_month must be on or after/)
  assert.match(text, /reminders contains "yesterday"/)
  assert.match(text, /target_day_of_prior_month must be on or after/)
  assert.match(text, /guardrails contains "nope"/)
  assert.match(text, /pricing\.default_basis/)
  assert.match(text, /template_multipliers\.closing/)
  assert.match(text, /telegram\.pilot/)

  assert.equal(validateSchedulingRules(null).ok, false)
  assert.equal(validateSchedulingRules([]).ok, false)
})

test('merge: partial override keeps default keys, one level deep per section', () => {
  const merged = mergeSchedulingRules(DEFAULT_SCHEDULING_RULES, { availability: { lock_day_of_prior_month: 20 }, store_ids: [] })
  assert.equal(merged.availability.lock_day_of_prior_month, 20)
  assert.equal(merged.availability.open_day_of_prior_month, 1)
  assert.deepEqual(merged.availability.reminders, ['open', 'T-3d', 'T-1d', 'locked'])
  assert.deepEqual(merged.store_ids, [])
  assert.deepEqual(merged.cover, DEFAULT_SCHEDULING_RULES.cover)
  // Does not mutate the base.
  assert.equal(DEFAULT_SCHEDULING_RULES.availability.lock_day_of_prior_month, 7)
})

test('availability window: open / lock / publish dates come from the prior month', () => {
  const rules = getSchedulingRules()
  const w = availabilityWindowFor(rules, '2026-10', '2026-09-04')
  assert.equal(w.open_date, '2026-09-01')
  assert.equal(w.lock_date, '2026-09-07')
  assert.equal(w.locked_from, '2026-09-08')
  assert.equal(w.publish_target_date, '2026-09-15')
  assert.equal(w.from, '2026-10-01')
  assert.equal(w.to, '2026-10-31')
  assert.equal(w.state, 'open')
  assert.equal(w.days_until_lock, 3)

  assert.equal(availabilityWindowFor(rules, '2026-10', '2026-08-31').state, 'upcoming')
  assert.equal(availabilityWindowFor(rules, '2026-10', '2026-09-07').state, 'open') // lock day itself is still open
  assert.equal(availabilityWindowFor(rules, '2026-10', '2026-09-08').state, 'locked')
  // January's window sits in the prior year.
  assert.equal(availabilityWindowFor(rules, '2027-01', '2026-12-03').open_date, '2026-12-01')

  assert.equal(isDateLockedByRules(rules, '2026-10-15', '2026-09-08'), true)
  assert.equal(isDateLockedByRules(rules, '2026-11-15', '2026-09-08'), false)
  assert.equal(isDateLockedByRules(rules, '2026-09-25', '2026-09-08'), true) // current month is always past its lock

  assert.equal(addMonths('2026-12', 1), '2027-01')
  assert.equal(addMonths('2026-01', -1), '2025-12')
  assert.deepEqual(monthBounds('2028-02'), { from: '2028-02-01', to: '2028-02-29' })
})

test('currentAvailabilityMonth: the nearest month that is not locked', () => {
  const rules = getSchedulingRules()
  assert.equal(currentAvailabilityMonth(rules, '2026-09-04').month, '2026-10')
  // After October locks (8 Sep), November is the live window even though it has not opened.
  const w = currentAvailabilityMonth(rules, '2026-09-11')
  assert.equal(w.month, '2026-11')
  assert.equal(w.state, 'upcoming')
})

test('remindersDueOn: open on open day, T-nd before lock, locked on the first locked day', () => {
  const rules = getSchedulingRules()
  const tok = (d) => remindersDueOn(rules, d).map((r) => `${r.token}:${r.month}`)
  assert.deepEqual(tok('2026-09-01'), ['open:2026-10'])
  assert.deepEqual(tok('2026-09-04'), ['T-3d:2026-10'])
  assert.deepEqual(tok('2026-09-06'), ['T-1d:2026-10'])
  assert.deepEqual(tok('2026-09-07'), [])
  assert.deepEqual(tok('2026-09-08'), ['locked:2026-10'])
  assert.deepEqual(tok('2026-09-15'), [])
  const custom = mergeSchedulingRules(rules, { availability: { open_day_of_prior_month: 1, lock_day_of_prior_month: 1, reminders: ['open', 'locked'] } })
  assert.deepEqual(remindersDueOn(custom, '2026-09-01').map((r) => r.token), ['open'])
  assert.deepEqual(remindersDueOn(custom, '2026-09-02').map((r) => r.token), ['locked'])
})

test('reminderCopy: wording differs for missing vs submitted', () => {
  const window = availabilityWindowFor(getSchedulingRules(), '2026-10', '2026-09-06')
  const missing = reminderCopy({ kind: 'countdown', token: 'T-1d', window, missing: true })
  const done = reminderCopy({ kind: 'countdown', token: 'T-1d', window, missing: false })
  assert.match(missing.title, /closes tomorrow/)
  assert.match(missing.body, /have not submitted/)
  assert.doesNotMatch(done.body, /have not submitted/)
  assert.match(reminderCopy({ kind: 'open', token: 'open', window }).title, /October 2026 availability is open/)
  assert.match(reminderCopy({ kind: 'locked', token: 'locked', window, missing: true }).telegram, /locked/)
})

test('parseAvailLines: the documented forms', () => {
  const today = '2026-09-11'
  const one = (s) => parseAvailLines(s, { today })
  assert.deepEqual(one('/avail 3 oct cant').entries, [{ work_date: '2026-10-03', kind: 'unavailable', start_time: null, end_time: null }])
  assert.deepEqual(one('/avail 2026-10-04 can 10:00-18:00').entries, [{ work_date: '2026-10-04', kind: 'available', start_time: '10:00', end_time: '18:00' }])
  assert.deepEqual(one('/avail oct 6-8 prefer').entries.map((e) => e.work_date), ['2026-10-06', '2026-10-07', '2026-10-08'])
  assert.deepEqual(one('/avail 3-5 oct cant').entries.map((e) => e.work_date), ['2026-10-03', '2026-10-04', '2026-10-05'])
  assert.deepEqual(one('/avail 3/10..5/10 cant').entries.map((e) => e.work_date), ['2026-10-03', '2026-10-04', '2026-10-05'])
  assert.deepEqual(one('/avail 2026-10-03 to 2026-10-05 cant').entries.length, 3)
  assert.deepEqual(one('/avail 4 oct can 10-18').entries[0], { work_date: '2026-10-04', kind: 'available', start_time: '10:00', end_time: '18:00' })
  assert.deepEqual(one('/avail@FranHrmBot 12 oct off').entries[0].kind, 'unavailable')
  const multi = one('/avail\n3 oct cant\n4 oct prefer 12:00 - 20:00')
  assert.equal(multi.entries.length, 2)
  assert.equal(multi.entries[1].start_time, '12:00')
  assert.equal(multi.errors.length, 0)
  // Unavailable never carries a window; a later line for the same date wins.
  const dup = one('/avail 3 oct can 10-18\n3 oct cant')
  assert.deepEqual(dup.entries, [{ work_date: '2026-10-03', kind: 'unavailable', start_time: null, end_time: null }])
  // Errors are per line and name the problem.
  assert.match(one('/avail 3 oct').errors[0], /say can, prefer or cant/)
  assert.match(one('/avail cant').errors[0], /no date found/)
  assert.match(one('/avail 31 sep cant').errors[0], /day 31 is not in 2026-09/)
  assert.match(one('/avail 3 cant').errors[0], /which month/)
  // Year inference rolls forward: "3 jan" in September means next January.
  assert.equal(one('/avail 3 jan cant').entries[0].work_date, '2027-01-03')
})

test('handleUpdate: ignores non-text updates, answers unlinked users without touching the DB write path', async () => {
  const replies = []
  const send = async (chatId, text) => { replies.push({ chatId, text }); return { ok: true } }
  const db = {
    from() {
      return {
        select() { return this }, eq() { return this }, maybeSingle: async () => ({ data: null, error: null }),
        update() { return this }, then(res) { return Promise.resolve().then(res) },
      }
    },
  }
  assert.deepEqual(await handleUpdate(db, { update_id: 1 }, { send }), { handled: false })
  const r = await handleUpdate(db, { message: { chat: { id: 42 }, from: { id: 7 }, text: '/status' } }, { send })
  assert.equal(r.error, 'unlinked')
  assert.equal(replies[0].chatId, 42)
  assert.match(replies[0].text, /\/link/)
  const r2 = await handleUpdate(db, { message: { chat: { id: 42 }, from: { id: 7 }, text: '/avail 3 oct cant' } }, { send })
  assert.equal(r2.error, 'unlinked')
})
