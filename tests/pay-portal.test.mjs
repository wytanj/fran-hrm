import test from 'node:test'
import assert from 'node:assert/strict'
import {
  generatePayPortalToken,
  isPayPortalLiveEligible,
  resolvePayPortalStaff,
} from '../core/payroll/payPortal.mjs'
import {
  isPayrollEligibleAsOf,
  resolveEligibleFrom,
  gatesBlockPay,
} from '../core/payroll/eligibility.mjs'

test('generatePayPortalToken matches TOKEN_RE shape', () => {
  const t = generatePayPortalToken()
  assert.match(t, /^pp_[A-Za-z0-9_-]{20,}$/)
})

test('isPayrollEligibleAsOf uses payroll_eligible_from / hired_on (no new column)', () => {
  assert.equal(isPayrollEligibleAsOf({ payroll_eligible_from: '2026-09-01' }, '2026-09-24'), true)
  assert.equal(isPayrollEligibleAsOf({ payroll_eligible_from: '2026-10-01' }, '2026-09-24'), false)
  assert.equal(isPayrollEligibleAsOf({ hired_on: '2026-09-01' }, '2026-09-24'), true)
  assert.equal(isPayrollEligibleAsOf({}, '2026-09-24'), false)
  assert.equal(resolveEligibleFrom({ payroll_eligible_from: '2026-01-01', hired_on: '2025-01-01' }), '2026-01-01')
})

test('gatesBlockPay blocks incomplete hire gates', () => {
  assert.equal(gatesBlockPay(null), false)
  assert.equal(gatesBlockPay({
    offer_accepted_on: '2026-01-01',
    docs_verified_on: '2026-01-02',
    nric_verified_on: '2026-01-03',
    start_on: '2026-01-04',
    first_store_presence_on: '2026-01-05',
  }), false)
  assert.equal(gatesBlockPay({
    offer_accepted_on: '2026-01-01',
    docs_verified_on: null,
    nric_verified_on: '2026-01-03',
    start_on: '2026-01-04',
    first_store_presence_on: '2026-01-05',
  }), true)
})

test('isPayPortalLiveEligible: active+eligible only; inactive/terminated never', () => {
  const eligible = { employment_status: 'active', payroll_eligible_from: '2026-01-01' }
  assert.equal(isPayPortalLiveEligible(eligible, { asOf: '2026-09-24' }), true)
  assert.equal(isPayPortalLiveEligible({ ...eligible, employment_status: 'inactive' }, { asOf: '2026-09-24' }), false)
  assert.equal(isPayPortalLiveEligible({ ...eligible, employment_status: 'terminated' }, { asOf: '2026-09-24' }), false)
  assert.equal(isPayPortalLiveEligible({ employment_status: 'active' }, { asOf: '2026-09-24' }), false)
  assert.equal(isPayPortalLiveEligible({
    employment_status: 'active',
    payroll_eligible_from: '2026-01-01',
  }, {
    asOf: '2026-09-24',
    gates: {
      offer_accepted_on: null,
      docs_verified_on: null,
      nric_verified_on: null,
      start_on: null,
      first_store_presence_on: null,
    },
  }), false)
})

function mockStaffDb(staffRow) {
  return {
    from(table) {
      if (table !== 'staff') throw new Error(`unexpected table ${table}`)
      return {
        select() {
          return {
            eq(_col, token) {
              return {
                async maybeSingle() {
                  if (staffRow && staffRow.pay_portal_token === token) return { data: staffRow, error: null }
                  return { data: null, error: null }
                },
              }
            },
          }
        },
      }
    },
  }
}

test('resolvePayPortalStaff returns active, inactive, and terminated (does not null out)', async () => {
  const token = 'pp_abcdefghijklmnopqrstuvwx'
  for (const status of ['active', 'inactive', 'terminated']) {
    const row = {
      id: 's1',
      workspace_id: 'w1',
      employee_code: 'E1',
      display_name: 'Ada',
      employment_type: 'full_time',
      employment_status: status,
      hired_on: '2026-01-01',
      payroll_eligible_from: '2026-01-01',
      pay_portal_token: token,
    }
    const found = await resolvePayPortalStaff(mockStaffDb(row), token)
    assert.ok(found, `expected resolve for ${status}`)
    assert.equal(found.employment_status, status)
  }
  assert.equal(await resolvePayPortalStaff(mockStaffDb(null), token), null)
  assert.equal(await resolvePayPortalStaff(mockStaffDb({
    pay_portal_token: token,
    employment_status: 'active',
  }), 'not-a-valid-token'), null)
})

test('before/after gate matrix for CoS', () => {
  // BEFORE: resolve null on terminated; AFTER: resolve all statuses; live only active+eligible
  const cases = [
    { status: 'active', eligible: true, expectLive: true },
    { status: 'active', eligible: false, expectLive: false },
    { status: 'inactive', eligible: true, expectLive: false },
    { status: 'terminated', eligible: true, expectLive: false },
  ]
  for (const c of cases) {
    const staff = {
      employment_status: c.status,
      payroll_eligible_from: c.eligible ? '2026-01-01' : null,
      hired_on: c.eligible ? '2026-01-01' : null,
    }
    assert.equal(
      isPayPortalLiveEligible(staff, { asOf: '2026-09-24' }),
      c.expectLive,
      `${c.status} eligible=${c.eligible}`,
    )
  }
})