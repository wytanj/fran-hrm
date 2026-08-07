#!/usr/bin/env node
// Seed the org chart + accountability register.
//
// Kept separate from seed.mjs so the org model can be reseeded while leaving
// rosters and clock history alone. Idempotent: fixed keys + upserts.
//
// Note the two title forms — `title` is what payroll calls the seat,
// `comms_title` is what we actually say ("Marketing Girlie").
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
try {
  const text = readFileSync(join(root, '.env'), 'utf8')
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
} catch {}

const db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
)

const WS = '11111111-1111-4111-8111-000000000001'
const ORCHARD = '11111111-1111-4111-8111-000000000011'

const FUNCTIONS = [
  { key: 'leadership', name: 'Leadership', description: 'Direction, capital allocation, and who is accountable for what.', sort_order: 10 },
  { key: 'retail_ops', name: 'Retail Operations', description: 'Everything that happens on the shop floor.', sort_order: 20 },
  { key: 'marketing', name: 'Marketing & Brand', description: 'Demand, brand voice, and the content calendar.', sort_order: 30 },
  { key: 'people', name: 'People & Culture', description: 'Hiring, rostering policy, training and wellbeing.', sort_order: 40 },
  { key: 'finance', name: 'Finance & Admin', description: 'Cash, payroll, compliance and reporting.', sort_order: 50 },
]

// code, title (formal), comms_title (what we say), function, reports_to code
const POSITIONS = [
  { code: 'FOUNDER', title: 'Founder & Managing Director', comms_title: 'Big Boss', fn: 'leadership', reports_to: null, purpose: 'Owns the direction of Fran and the results of the whole business.', expected_role: 'hq_admin', is_leadership: true, sort_order: 10 },
  { code: 'AM', title: 'Area Manager', comms_title: 'Retail Queen', fn: 'retail_ops', reports_to: 'FOUNDER', purpose: 'Owns commercial performance across all stores.', expected_role: 'area_manager', is_leadership: true, sort_order: 20 },
  { code: 'MKT_LEAD', title: 'Marketing Manager', comms_title: 'Marketing Girlie', fn: 'marketing', reports_to: 'FOUNDER', purpose: 'Owns demand generation and how Fran sounds everywhere.', expected_role: 'hq_admin', is_leadership: true, sort_order: 30 },
  { code: 'PEOPLE_LEAD', title: 'People & Culture Lead', comms_title: 'People Person', fn: 'people', reports_to: 'FOUNDER', purpose: 'Owns hiring, rostering policy and how it feels to work here.', expected_role: 'hq_admin', is_leadership: true, sort_order: 40 },
  { code: 'SM', title: 'Store Manager', comms_title: 'Store Mum', fn: 'retail_ops', reports_to: 'AM', purpose: 'Owns one store: its numbers, its team and its standards.', expected_role: 'store_manager', is_leadership: false, store: ORCHARD, sort_order: 50 },
  { code: 'SUP', title: 'Store Supervisor', comms_title: 'Shift Captain', fn: 'retail_ops', reports_to: 'SM', purpose: 'Owns the shift in front of them — cover, service and closing.', expected_role: 'supervisor', is_leadership: false, store: ORCHARD, sort_order: 60 },
  { code: 'BA', title: 'Beauty Advisor', comms_title: 'Glow Guide', fn: 'retail_ops', reports_to: 'SUP', purpose: 'Owns the customer in front of them and the counter they work.', expected_role: 'staff', is_leadership: false, store: ORCHARD, headcount: 4, sort_order: 70 },
]

// Seat assignments for the seeded staff, plus per-person comms overrides.
const STAFF_SEATS = [
  { code: 'HQ001', position: 'FOUNDER' },
  { code: 'AM001', position: 'AM' },
  { code: 'SM001', position: 'SM' },
  { code: 'SV001', position: 'SUP' },
  { code: 'ST001', position: 'BA' },
  { code: 'PT001', position: 'BA', comms_title: 'Weekend Glow Guide' },
  { code: 'PT002', position: 'BA' },
]

// The accountability register. One accountable owner each, seat-first.
const ACCOUNTABILITIES = [
  { key: 'store-revenue', name: 'Store revenue vs target', outcome: 'Each store hits its monthly revenue target.', fn: 'retail_ops', owner: 'AM', metric_name: 'Revenue vs target', metric_target: 100, metric_unit: '%', cadence: 'monthly', sort_order: 10 },
  { key: 'manpower-cost', name: 'Manpower cost as % of sales', outcome: 'Labour stays within the agreed percentage of sales without hurting service.', fn: 'retail_ops', owner: 'AM', metric_name: 'Manpower cost ratio', metric_target: 12, metric_unit: '%', cadence: 'monthly', sort_order: 20 },
  { key: 'roster-published', name: 'Roster published on time', outcome: 'Every store roster is published at least 7 days before the week starts.', fn: 'retail_ops', owner: 'SM', metric_name: 'Weeks published on time', metric_target: 100, metric_unit: '%', cadence: 'weekly', store: ORCHARD, sort_order: 30 },
  { key: 'shift-cover', name: 'Shift cover', outcome: 'No shift goes uncovered; no-shows are resolved within the hour.', fn: 'retail_ops', owner: 'SUP', metric_name: 'Uncovered shifts', metric_target: 0, metric_unit: 'shifts', cadence: 'weekly', store: ORCHARD, sort_order: 40 },
  { key: 'timesheet-accuracy', name: 'Timesheet accuracy before payroll', outcome: 'Every pay period is reviewed with zero unresolved corrections before locking.', fn: 'finance', owner: 'SM', metric_name: 'Unresolved corrections at lock', metric_target: 0, metric_unit: 'items', cadence: 'fortnightly', sort_order: 50 },
  { key: 'payroll-run', name: 'Payroll runs correctly and on time', outcome: 'Staff are paid the right amount on the right day, every time.', fn: 'finance', owner: 'FOUNDER', metric_name: 'Late or incorrect payslips', metric_target: 0, metric_unit: 'payslips', cadence: 'monthly', sort_order: 60 },
  { key: 'mom-compliance', name: 'MOM compliance', outcome: 'OT thresholds, rest days and 2-year record retention are all observed.', fn: 'people', owner: 'PEOPLE_LEAD', metric_name: 'Open compliance breaches', metric_target: 0, metric_unit: 'breaches', cadence: 'monthly', sort_order: 70 },
  { key: 'hiring-pipeline', name: 'Hiring pipeline for peak', outcome: 'Enough trained part-timers are onboarded before each peak season.', fn: 'people', owner: 'PEOPLE_LEAD', metric_name: 'PT bench vs plan', metric_target: 100, metric_unit: '%', cadence: 'monthly', sort_order: 80 },
  { key: 'content-calendar', name: 'Content calendar shipped', outcome: 'Planned campaigns and posts go out on schedule, in Fran\'s voice.', fn: 'marketing', owner: 'MKT_LEAD', metric_name: 'Posts shipped vs planned', metric_target: 95, metric_unit: '%', cadence: 'weekly', sort_order: 90 },
  { key: 'brand-voice', name: 'Brand voice consistency', outcome: 'Everything customer-facing sounds like Fran, wherever it appears.', fn: 'marketing', owner: 'MKT_LEAD', metric_name: 'Off-brand escalations', metric_target: 0, metric_unit: 'items', cadence: 'monthly', sort_order: 100 },
  { key: 'staff-training', name: 'New starter training completed', outcome: 'Every new starter finishes counter training within their first two weeks.', fn: 'people', owner: 'SM', metric_name: 'Training completed in 14 days', metric_target: 100, metric_unit: '%', cadence: 'monthly', store: ORCHARD, sort_order: 110 },
]

async function main() {
  // Functions
  const fnIds = {}
  for (const f of FUNCTIONS) {
    const { data, error } = await db.from('org_functions')
      .upsert({ workspace_id: WS, ...f }, { onConflict: 'workspace_id,key' })
      .select('id, key').single()
    if (error) throw new Error(`function ${f.key}: ${error.message}`)
    fnIds[data.key] = data.id
  }
  console.log(`functions: ${Object.keys(fnIds).length}`)

  // Positions — two passes so reports_to can reference seats created later.
  const posIds = {}
  for (const p of POSITIONS) {
    const { data, error } = await db.from('positions').upsert({
      workspace_id: WS, code: p.code, title: p.title, comms_title: p.comms_title,
      function_id: fnIds[p.fn], purpose: p.purpose, expected_role: p.expected_role,
      is_leadership: p.is_leadership, headcount: p.headcount ?? 1,
      store_id: p.store || null, sort_order: p.sort_order,
    }, { onConflict: 'workspace_id,code' }).select('id, code').single()
    if (error) throw new Error(`position ${p.code}: ${error.message}`)
    posIds[data.code] = data.id
  }
  for (const p of POSITIONS) {
    if (!p.reports_to) continue
    const { error } = await db.from('positions')
      .update({ reports_to_id: posIds[p.reports_to] }).eq('id', posIds[p.code])
    if (error) throw new Error(`link ${p.code}: ${error.message}`)
  }
  console.log(`positions: ${Object.keys(posIds).length}`)

  // Staff → seats
  for (const s of STAFF_SEATS) {
    const { error } = await db.from('staff')
      .update({ position_id: posIds[s.position], comms_title: s.comms_title || null })
      .eq('workspace_id', WS).eq('employee_code', s.code)
    if (error) throw new Error(`staff ${s.code}: ${error.message}`)
  }
  console.log(`staff seated: ${STAFF_SEATS.length}`)

  // Accountabilities
  let accCount = 0
  for (const a of ACCOUNTABILITIES) {
    const { error } = await db.from('accountabilities').upsert({
      workspace_id: WS, key: a.key, name: a.name, outcome: a.outcome,
      function_id: fnIds[a.fn], owner_position_id: posIds[a.owner],
      metric_name: a.metric_name, metric_target: a.metric_target, metric_unit: a.metric_unit,
      cadence: a.cadence, store_id: a.store || null, sort_order: a.sort_order,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id,key' })
    if (error) throw new Error(`accountability ${a.key}: ${error.message}`)
    accCount += 1
  }
  console.log(`accountabilities: ${accCount}`)

  // A couple of contributors + check-ins so the model has something to show.
  const { data: accRows } = await db.from('accountabilities')
    .select('id, key').eq('workspace_id', WS)
  const accByKey = new Map((accRows || []).map((r) => [r.key, r.id]))
  const { data: staffRows } = await db.from('staff')
    .select('id, employee_code').eq('workspace_id', WS)
  const staffByCode = new Map((staffRows || []).map((r) => [r.employee_code, r.id]))

  const contributors = [
    { acc: 'shift-cover', staff: 'SM001', role: 'consulted' },
    { acc: 'roster-published', staff: 'SV001', role: 'contributor' },
    { acc: 'timesheet-accuracy', staff: 'SV001', role: 'contributor' },
    { acc: 'staff-training', staff: 'SV001', role: 'contributor' },
  ]
  for (const c of contributors) {
    const accId = accByKey.get(c.acc)
    const staffId = staffByCode.get(c.staff)
    if (!accId || !staffId) continue
    const { data: exists } = await db.from('accountability_contributors')
      .select('id').eq('accountability_id', accId).eq('staff_id', staffId).maybeSingle()
    if (exists) continue
    await db.from('accountability_contributors')
      .insert({ workspace_id: WS, accountability_id: accId, staff_id: staffId, role: c.role })
  }

  const checkins = [
    { acc: 'roster-published', period_start: '2026-07-27', metric_value: 100, status: 'active', note: 'Published Wednesday, 11 days ahead.' },
    { acc: 'roster-published', period_start: '2026-08-03', metric_value: 100, status: 'active', note: 'On time.' },
    { acc: 'shift-cover', period_start: '2026-08-03', metric_value: 1, status: 'at_risk', note: 'One uncovered Saturday close after a late no-show.' },
    { acc: 'manpower-cost', period_start: '2026-07-01', metric_value: 13.4, status: 'at_risk', note: 'Above 12% — extra PT hours during the July promo.' },
  ]
  // Latest check-in drives the register's headline status, same rule the
  // check-in endpoint applies — otherwise the seed would show "active" for
  // something its own review flagged as at risk.
  const latestStatus = new Map()
  for (const c of checkins) {
    const accId = accByKey.get(c.acc)
    if (!accId) continue
    await db.from('accountability_checkins').upsert({
      workspace_id: WS, accountability_id: accId, period_start: c.period_start,
      metric_value: c.metric_value, status: c.status, note: c.note,
      recorded_by: staffByCode.get('AM001'),
    }, { onConflict: 'accountability_id,period_start' })
    const prev = latestStatus.get(c.acc)
    if (!prev || c.period_start > prev.period_start) latestStatus.set(c.acc, c)
  }
  for (const [key, c] of latestStatus) {
    await db.from('accountabilities')
      .update({ status: c.status }).eq('id', accByKey.get(key))
  }
  console.log(`contributors + check-ins seeded`)
  console.log('\nOrg seed complete. Comms titles in play: Big Boss, Retail Queen, Marketing Girlie, People Person, Store Mum, Shift Captain, Glow Guide.')
}

main().catch((err) => { console.error('org seed failed:', err.message); process.exit(1) })
