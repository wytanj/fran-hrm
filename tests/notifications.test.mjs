import test from 'node:test'
import assert from 'node:assert/strict'
import { createNotification, markRead } from '../core/notifications/record.mjs'
import {
  formatDateSpan, isContiguous, datesOverlapRange,
  availabilityLockNotification, summariseLockEvent,
} from '../core/roster/lockCopy.mjs'
import { presentLockEvents } from '../core/roster/lockHistory.mjs'

test('formatDateSpan: single day, contiguous week, gaps, cross-year', () => {
  assert.equal(formatDateSpan(['2026-08-24']), '24 Aug')
  assert.equal(formatDateSpan(['2026-08-30', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29']), '24–30 Aug')
  assert.equal(formatDateSpan(['2026-08-24', '2026-08-26']), '24 Aug and 26 Aug')
  assert.equal(formatDateSpan(['2026-08-24', '2026-08-26', '2026-08-28']), '24 Aug, 26 Aug and 28 Aug')
  assert.equal(formatDateSpan(['2026-08-24', '2026-08-26', '2026-08-28', '2026-08-30']), '4 dates (24 Aug–30 Aug)')
  assert.equal(formatDateSpan(['2026-12-31', '2027-01-01']), '31 Dec 2026–1 Jan 2027')
  assert.equal(formatDateSpan([]), 'those dates')
})

test('isContiguous', () => {
  assert.equal(isContiguous(['2026-08-24']), true)
  assert.equal(isContiguous(['2026-08-24', '2026-08-25', '2026-08-26']), true)
  assert.equal(isContiguous(['2026-08-24', '2026-08-26']), false)
})

test('availabilityLockNotification: one date vs a week, with and without actor', () => {
  const week = availabilityLockNotification({
    locked: true,
    dates: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
    actorName: 'Chloe Tan',
  })
  assert.equal(week.type, 'availability_locked')
  assert.equal(week.title, 'Availability locked')
  assert.equal(week.body, 'Your availability for 24–30 Aug was locked by Chloe Tan.')
  assert.equal(week.link, '/availability')
  assert.equal(week.metadata.operation, 'LOCK')
  assert.deepEqual(week.metadata.dates, [
    '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27',
    '2026-08-28', '2026-08-29', '2026-08-30',
  ])

  const one = availabilityLockNotification({
    locked: false,
    dates: ['2026-08-26'],
    actorName: 'Chloe Tan',
  })
  assert.equal(one.type, 'availability_unlocked')
  assert.equal(one.body, 'Your availability for 26 Aug was unlocked by Chloe Tan.')

  const noActor = availabilityLockNotification({ locked: true, dates: ['2026-08-24'] })
  assert.equal(noActor.body, 'Your availability for 24 Aug was locked.')
})

test('summariseLockEvent matches the roster-history voice', () => {
  assert.equal(
    summariseLockEvent({
      operation: 'LOCK',
      staffName: 'Erin Goh',
      dates: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'],
      actorName: 'Chloe Tan',
    }),
    "Chloe Tan locked Erin Goh's availability for 24–30 Aug",
  )
  assert.equal(
    summariseLockEvent({
      operation: 'UNLOCK',
      staffName: 'Erin Goh',
      dates: ['2026-08-26'],
      actorName: 'Chloe Tan',
    }),
    "Chloe Tan unlocked Erin Goh's availability for 26 Aug",
  )
})

test('datesOverlapRange: event is in the week if ANY locked date falls in it', () => {
  const dates = ['2026-08-24', '2026-08-25', '2026-08-26']
  assert.equal(datesOverlapRange(dates, '2026-08-24', '2026-08-30'), true)
  assert.equal(datesOverlapRange(dates, '2026-08-26', '2026-08-26'), true)
  assert.equal(datesOverlapRange(dates, '2026-08-17', '2026-08-23'), false)
  assert.equal(datesOverlapRange(['2026-08-31'], '2026-08-24', '2026-08-30'), false)
})

test('presentLockEvents filters by locked-date overlap and store, newest first', () => {
  const raw = [
    {
      id: 'old',
      created_at: '2026-08-10T02:00:00Z',
      actor_name: 'Chloe Tan',
      actor_kind: 'user',
      source_type: 'web',
      entity_id: 'erin',
      operation: 'LOCK',
      after_data: { dates: ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'] },
      metadata: {},
    },
    {
      id: 'recent',
      created_at: '2026-08-26T09:00:00Z',
      actor_name: 'Chloe Tan',
      actor_kind: 'user',
      source_type: 'web',
      entity_id: 'erin',
      operation: 'UNLOCK',
      after_data: { dates: ['2026-08-26'] },
      metadata: { reason: 'she needs to change Saturday' },
    },
    {
      id: 'other-week',
      created_at: '2026-08-26T10:00:00Z',
      actor_name: 'Chloe Tan',
      actor_kind: 'user',
      source_type: 'web',
      entity_id: 'farah',
      operation: 'LOCK',
      after_data: { dates: ['2026-09-07'] },
      metadata: {},
    },
    {
      id: 'other-store',
      created_at: '2026-08-26T11:00:00Z',
      actor_name: 'Dylan',
      actor_kind: 'user',
      source_type: 'mcp',
      entity_id: 'kai',
      operation: 'LOCK',
      after_data: { dates: ['2026-08-24'] },
      metadata: {},
    },
  ]
  const staff = [
    { id: 'erin', display_name: 'Erin Goh', employee_code: 'ER001', home_store_id: 'orchard' },
    { id: 'farah', display_name: 'Farah', employee_code: 'FA001', home_store_id: 'orchard' },
    { id: 'kai', display_name: 'Kai', employee_code: 'KA001', home_store_id: 'bugis' },
  ]

  const week = presentLockEvents(raw, staff, { from: '2026-08-24', to: '2026-08-30' })
  assert.deepEqual(week.map((e) => e.id), ['other-store', 'recent', 'old'])
  assert.equal(week[0].source, 'mcp')
  assert.equal(week.find((e) => e.id === 'recent').reason, 'she needs to change Saturday')
  assert.equal(week.find((e) => e.id === 'old').summary, "Chloe Tan locked Erin Goh's availability for 24–30 Aug")

  const orchard = presentLockEvents(raw, staff, { storeId: 'orchard', from: '2026-08-24', to: '2026-08-30' })
  assert.deepEqual(orchard.map((e) => e.id), ['recent', 'old'])

  const unknown = presentLockEvents(
    [{ ...raw[0], entity_id: 'gone', id: 'gone' }],
    staff,
    { from: '2026-08-24', to: '2026-08-30' },
  )
  assert.equal(unknown[0].staff.name, 'Unknown staff')
})

function throwingDb() {
  return { from() { throw new Error('network down') } }
}

function errorInsertDb() {
  return {
    from() {
      return { insert: async () => ({ error: { message: 'duplicate' } }) }
    },
  }
}

test('createNotification never throws on insert error or exception', async () => {
  await assert.doesNotReject(() => createNotification(throwingDb(), {
    workspace_id: 'w', staff_id: 's', type: 'availability_locked', title: 'x',
  }))
  await assert.doesNotReject(() => createNotification(errorInsertDb(), {
    workspace_id: 'w', staff_id: 's', type: 'availability_locked', title: 'x',
  }))
  await assert.doesNotReject(() => createNotification(errorInsertDb(), {}))
})

test('markRead with an empty id list is a no-op (does not hit the db)', async () => {
  await markRead(throwingDb(), 'w', 's', [])
  await markRead(throwingDb(), 'w', 's', [null, '  '])
})
