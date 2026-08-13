#!/usr/bin/env node
// FranHRM seed: one workspace, HQ + Orchard store, staff across every role,
// shift templates, leave types/balances, two published rosters + a draft,
// two weeks of clock data, sample requests, and an MCP/API key (printed once).
//
// Idempotent: fixed UUIDs + upserts, so re-running refreshes rather than
// duplicates. Demo PIN for every seeded account: 123456.
import { createHash, randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import bcrypt from 'bcryptjs'
import postgres from 'postgres'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadDotEnv() {
  try {
    const text = readFileSync(join(root, '.env'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
}
loadDotEnv()

const sql = postgres(process.env.SUPABASE_CONNECTION_STRING, { ssl: 'require', max: 1, prepare: false })

const WS = '11111111-1111-4111-8111-000000000001'
const HQ = '11111111-1111-4111-8111-000000000010'
const ORCHARD = '11111111-1111-4111-8111-000000000011'

const STAFF = [
  { id: '22222222-1111-4111-8111-000000000001', code: 'HQ001', name: 'Ava Ong', role: 'hq_admin', type: 'full_time', store: HQ, email: 'ava@fran.sg', gender: 'female', salary: 1200000, race: 'chinese', residency: 'citizen', nationality: 'Singaporean', nric: 'S8000001A', dob: '1980-03-12', addr1: '12 Ardmore Park', unit: '#10-01', postal: '259960', phone: '90000001' },
  { id: '22222222-1111-4111-8111-000000000002', code: 'AM001', name: 'Ben Lim', role: 'area_manager', type: 'full_time', store: HQ, email: 'ben@fran.sg', gender: 'male', salary: 800000, race: 'chinese', residency: 'citizen', nationality: 'Singaporean', nric: 'S8500002B', dob: '1985-07-04', addr1: '88 Zion Rd', unit: '#05-12', postal: '247792', phone: '90000002' },
  { id: '22222222-1111-4111-8111-000000000003', code: 'SM001', name: 'Chloe Tan', role: 'store_manager', type: 'full_time', store: ORCHARD, email: 'chloe@fran.sg', gender: 'female', salary: 550000, race: 'chinese', residency: 'citizen', nationality: 'Singaporean', nric: 'S9000003C', dob: '1990-11-21', addr1: '391 Orchard Rd', unit: '#12-08', postal: '238872', phone: '90000003' },
  { id: '22222222-1111-4111-8111-000000000004', code: 'SV001', name: 'Dylan Ng', role: 'supervisor', type: 'full_time', store: ORCHARD, email: 'dylan@fran.sg', gender: 'male', salary: 420000, race: 'malay', residency: 'citizen', nationality: 'Singaporean', nric: 'S9200004D', dob: '1992-02-18', addr1: '50 East Coast Rd', unit: '#03-04', postal: '428769', phone: '90000004' },
  { id: '22222222-1111-4111-8111-000000000005', code: 'ST001', name: 'Erin Goh', role: 'staff', type: 'full_time', store: ORCHARD, email: 'erin@fran.sg', gender: 'female', salary: 320000, race: 'chinese', residency: 'citizen', nationality: 'Singaporean', nric: 'S9800005E', dob: '1998-06-09', addr1: '21 Geylang Rd', unit: '#08-22', postal: '389193', phone: '90000005' },
  { id: '22222222-1111-4111-8111-000000000006', code: 'PT001', name: 'Farah Iman', role: 'staff', type: 'part_time', store: ORCHARD, rate: 1500, capW: 30, capM: 120, email: 'farah@fran.sg', gender: 'female', race: 'malay', residency: 'pr', nationality: 'Malaysian', nric: 'F9500006F', dob: '1995-09-30', prStart: '2023-01-15', addr1: '7 Jalan Bukit Merah', unit: '#14-03', postal: '150007', phone: '90000006' },
  { id: '22222222-1111-4111-8111-000000000007', code: 'PT002', name: 'Gavin Lee', role: 'staff', type: 'part_time', store: ORCHARD, rate: 1400, capW: 25, capM: 100, email: 'gavin@fran.sg', gender: 'male', race: 'chinese', residency: 'foreigner', nationality: 'Malaysian', nric: 'G9900007G', dob: '1999-12-01', cpf: false, addr1: '3 Coleman St', unit: '#02-19', postal: '179804', phone: '90000007' },
]

const TEMPLATES = [
  { id: '33333333-1111-4111-8111-000000000001', name: 'Opening', start: '09:30', end: '18:30', break: 60 },
  { id: '33333333-1111-4111-8111-000000000002', name: 'Closing', start: '12:00', end: '21:00', break: 60 },
  { id: '33333333-1111-4111-8111-000000000003', name: 'Mid', start: '10:30', end: '19:30', break: 60 },
]

const LEAVE_TYPES = [
  { id: '44444444-1111-4111-8111-000000000001', code: 'AL', name: 'Annual Leave', paid: true, days: 14 },
  { id: '44444444-1111-4111-8111-000000000002', code: 'MC', name: 'Medical Leave', paid: true, days: 14, attach: true },
  { id: '44444444-1111-4111-8111-000000000003', code: 'UL', name: 'Unpaid Leave', paid: false, days: 0 },
  { id: '44444444-1111-4111-8111-000000000004', code: 'CL', name: 'Compassionate Leave', paid: true, days: 3 },
]

// Deterministic UUIDs for generated rows so reseeding stays idempotent.
function detId(...parts) {
  const h = createHash('sha256').update(parts.join('|')).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`
}

const sgt = (date, time) => `${date}T${time}:00+08:00`
const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

async function main() {
  await sql`insert into public.workspaces (id, name, slug) values (${WS}, 'Fran', 'fran')
    on conflict (id) do update set name = excluded.name`

  await sql`insert into public.stores (id, workspace_id, code, name, kind, address, timezone) values
    (${HQ}, ${WS}, 'FRANHQ', 'Fran HQ', 'hq', '100 Beach Rd, Singapore', 'Asia/Singapore'),
    (${ORCHARD}, ${WS}, 'FRAN01', 'Fran Beauty Orchard', 'store', '391 Orchard Rd, Singapore', 'Asia/Singapore')
    on conflict (id) do update set name = excluded.name, code = excluded.code`

  const pinHash = bcrypt.hashSync('123456', 10)
  for (const s of STAFF) {
    await sql`insert into public.staff
      (id, workspace_id, employee_code, display_name, email, phone, role, employment_type, home_store_id,
       hourly_rate_cents, monthly_salary_cents, pt_weekly_hour_cap, pt_monthly_hour_cap, hired_on, pin_hash,
       gender, race, residency, nationality, nric, date_of_birth, pr_start_date, cpf_applicable,
       address_line_1, unit_number, postal_code, country)
      values (${s.id}, ${WS}, ${s.code}, ${s.name}, ${s.email}, ${s.phone ?? null}, ${s.role}, ${s.type}, ${s.store},
       ${s.rate ?? null}, ${s.salary ?? null}, ${s.capW ?? null}, ${s.capM ?? null}, '2025-01-06', ${pinHash},
       ${s.gender ?? null}, ${s.race ?? null}, ${s.residency ?? null}, ${s.nationality ?? null},
       ${s.nric ?? null}, ${s.dob ?? null}, ${s.prStart ?? null}, ${s.cpf !== false},
       ${s.addr1 ?? null}, ${s.unit ?? null}, ${s.postal ?? null}, 'SG')
      on conflict (id) do update set display_name = excluded.display_name, role = excluded.role,
        employment_type = excluded.employment_type, home_store_id = excluded.home_store_id,
        hourly_rate_cents = excluded.hourly_rate_cents, monthly_salary_cents = excluded.monthly_salary_cents,
        phone = excluded.phone, gender = excluded.gender, race = excluded.race, residency = excluded.residency,
        nationality = excluded.nationality, nric = excluded.nric, date_of_birth = excluded.date_of_birth,
        pr_start_date = excluded.pr_start_date, cpf_applicable = excluded.cpf_applicable,
        address_line_1 = excluded.address_line_1, unit_number = excluded.unit_number,
        postal_code = excluded.postal_code, country = excluded.country`
    await sql`insert into public.staff_store_assignments (id, workspace_id, staff_id, store_id, is_primary)
      values (${detId('assign', s.id, s.store)}, ${WS}, ${s.id}, ${s.store}, true)
      on conflict (staff_id, store_id) do nothing`
  }

  for (const t of TEMPLATES) {
    await sql`insert into public.shift_templates (id, workspace_id, store_id, name, start_time, end_time, break_minutes)
      values (${t.id}, ${WS}, null, ${t.name}, ${t.start}, ${t.end}, ${t.break})
      on conflict (id) do update set name = excluded.name`
  }

  for (const lt of LEAVE_TYPES) {
    await sql`insert into public.leave_types (id, workspace_id, code, name, is_paid, default_days_per_year, requires_attachment)
      values (${lt.id}, ${WS}, ${lt.code}, ${lt.name}, ${lt.paid}, ${lt.days}, ${lt.attach ?? false})
      on conflict (id) do update set name = excluded.name`
    for (const s of STAFF.filter((x) => x.type === 'full_time')) {
      await sql`insert into public.leave_balances (id, workspace_id, staff_id, leave_type_id, year, entitled_days)
        values (${detId('bal', s.id, lt.id, '2026')}, ${WS}, ${s.id}, ${lt.id}, 2026, ${lt.days})
        on conflict (staff_id, leave_type_id, year) do nothing`
    }
  }

  // ── Rosters: two published weeks + a draft for next week (Orchard) ──
  const weeks = [
    { start: '2026-07-27', status: 'published' },
    { start: '2026-08-03', status: 'published' },
    { start: '2026-08-10', status: 'draft' },
  ]
  const floor = STAFF.filter((s) => s.store === ORCHARD)
  for (const w of weeks) {
    const rosterId = detId('roster', ORCHARD, w.start)
    await sql`insert into public.rosters (id, workspace_id, store_id, week_start, status, published_at, published_by)
      values (${rosterId}, ${WS}, ${ORCHARD}, ${w.start}, ${w.status},
        ${w.status === 'published' ? sgt(w.start, '18:00') : null},
        ${w.status === 'published' ? STAFF[2].id : null})
      on conflict (store_id, week_start) do update set status = excluded.status`

    for (let d = 0; d < 7; d++) {
      const date = addDays(w.start, d)
      for (let i = 0; i < floor.length; i++) {
        const s = floor[i]
        // FT rest days: SM off Sun, SV off Mon, FT staff off Tue. PT works Thu-Sun only.
        const dayOff = (s.code === 'SM001' && d === 6) || (s.code === 'SV001' && d === 0) || (s.code === 'ST001' && d === 1)
        const ptSkip = s.type === 'part_time' && d < 3
        if (dayOff || ptSkip) continue
        const tpl = TEMPLATES[(d + i) % 2] // alternate Opening/Closing
        await sql`insert into public.shifts
          (id, workspace_id, roster_id, store_id, staff_id, work_date, start_at, end_at, break_minutes, template_id, job_code)
          values (${detId('shift', rosterId, s.id, date)}, ${WS}, ${rosterId}, ${ORCHARD}, ${s.id}, ${date},
            ${sgt(date, tpl.start)}, ${sgt(date, tpl.end)}, ${tpl.break}, ${tpl.id},
            ${s.type === 'part_time' ? 'sales_floor' : null})
          on conflict (id) do update set start_at = excluded.start_at, end_at = excluded.end_at`
      }
    }
  }

  // ── Clock data: mirror published shifts through yesterday (2026-08-06) ──
  const today = '2026-08-07'
  const shifts = await sql`select s.* from public.shifts s
    join public.rosters r on r.id = s.roster_id
    where r.status = 'published' and s.work_date < ${today} and s.staff_id is not null`
  for (const sh of shifts) {
    const jitterIn = (sh.staff_id.endsWith('5') && sh.work_date === '2026-08-04') ? 22 : (parseInt(sh.id.slice(0, 2), 16) % 9) - 4
    const inAt = new Date(new Date(sh.start_at).getTime() + jitterIn * 60000)
    // Erin pulls a long OT close on 2026-07-30
    const otLate = sh.staff_id === STAFF[4].id && sh.work_date === '2026-07-30' ? 150 : (parseInt(sh.id.slice(2, 4), 16) % 12)
    const outAt = new Date(new Date(sh.end_at).getTime() + otLate * 60000)
    const teId = detId('te', sh.id)
    await sql`insert into public.time_entries
      (id, workspace_id, store_id, staff_id, shift_id, work_date, clock_in_at, clock_out_at, break_minutes, job_code, source, status)
      values (${teId}, ${WS}, ${sh.store_id}, ${sh.staff_id}, ${sh.id}, ${sh.work_date},
        ${inAt.toISOString()}, ${outAt.toISOString()}, ${sh.break_minutes}, ${sh.job_code}, 'clock', 'closed')
      on conflict (id) do update set clock_in_at = excluded.clock_in_at, clock_out_at = excluded.clock_out_at`
    for (const [type, at] of [['clock_in', inAt], ['clock_out', outAt]]) {
      await sql`insert into public.clock_events (id, workspace_id, store_id, staff_id, type, at, method)
        values (${detId('ce', sh.id, type)}, ${WS}, ${sh.store_id}, ${sh.staff_id}, ${type}, ${at.toISOString()}, 'qr')
        on conflict (id) do nothing`
    }
    if (jitterIn > 5) {
      await sql`insert into public.attendance_flags (id, workspace_id, staff_id, store_id, shift_id, time_entry_id, work_date, flag_type, details)
        values (${detId('flag', sh.id, 'late')}, ${WS}, ${sh.staff_id}, ${sh.store_id}, ${sh.id}, ${teId}, ${sh.work_date},
          'late', ${JSON.stringify({ minutes_late: jitterIn, grace_minutes: 5 })})
        on conflict (id) do nothing`
    }
  }

  // ── Sample workflow items ──
  await sql`insert into public.leave_requests (id, workspace_id, staff_id, leave_type_id, start_date, end_date, days, reason, status)
    values (${detId('leave', 'erin-al')}, ${WS}, ${STAFF[4].id}, ${LEAVE_TYPES[0].id}, '2026-08-14', '2026-08-14', 1, 'Family event', 'pending')
    on conflict (id) do nothing`
  await sql`insert into public.leave_requests (id, workspace_id, staff_id, leave_type_id, start_date, end_date, days, reason, status, decided_by, decided_at)
    values (${detId('leave', 'dylan-al')}, ${WS}, ${STAFF[3].id}, ${LEAVE_TYPES[0].id}, '2026-08-12', '2026-08-13', 2, 'Short trip', 'approved', ${STAFF[2].id}, now())
    on conflict (id) do nothing`
  await sql`insert into public.time_corrections (id, workspace_id, staff_id, store_id, work_date, field, new_value, reason, status, requested_by)
    values (${detId('corr', 'farah-0802')}, ${WS}, ${STAFF[5].id}, ${ORCHARD}, '2026-08-02', 'clock_out_at', ${sgt('2026-08-02', '21:05')}, 'Forgot to clock out after closing', 'pending', ${STAFF[5].id})
    on conflict (id) do nothing`

  // Availability for PT staff, next week
  for (const s of [STAFF[5], STAFF[6]]) {
    for (let d = 0; d < 7; d++) {
      const date = addDays('2026-08-10', d)
      const kind = d < 2 ? 'unavailable' : 'available'
      await sql`insert into public.availability (id, workspace_id, staff_id, work_date, kind, start_time, end_time)
        values (${detId('avail', s.id, date)}, ${WS}, ${s.id}, ${date}, ${kind}, ${d < 2 ? null : '10:00'}, ${d < 2 ? null : '21:30'})
        on conflict (id) do nothing`
    }
  }

  // ── API key (printed once; only the hash is stored) ──
  const existing = await sql`select id from public.api_keys where workspace_id = ${WS} and name = 'seed-mcp-full'`
  if (existing.length === 0) {
    const raw = `sk_live_${randomBytes(32).toString('base64url')}`
    const hash = createHash('sha256').update(raw).digest('hex')
    await sql`insert into public.api_keys (workspace_id, name, prefix, key_hash, scopes)
      values (${WS}, 'seed-mcp-full', ${raw.slice(0, 16)}, ${hash}, ${sql.array(['mcp:full'])})`
    console.log('\n=== API KEY (save this — shown once) ===')
    console.log(raw)
    console.log('========================================\n')
  }

  console.log(`workspace_id: ${WS}`)
  console.log('Seed complete. Demo PIN for all accounts: 123456')
  console.log('Logins: HQ001 (hq_admin) AM001 (area_manager) SM001 (store_manager) SV001 (supervisor) ST001 (staff FT) PT001/PT002 (staff PT)')
  await sql.end()
}

main().catch((err) => { console.error('seed failed:', err); process.exit(1) })
