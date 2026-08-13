// Staff directory queries shared by REST + MCP. Compact projections and
// clamped limits — agent surfaces get exact counts, never full dumps.
// Pay + statutory identity are stripped unless opts.includeSensitive
// (reports:cost or staff:write). includeRate is kept as an alias.

export const STAFF_SELECT = '*, home_store:home_store_id(id, code, name), position:position_id(id, code, title, comms_title, function_id, reports_to_id, purpose, function:function_id(id, key, name))'

export function clampLimit(n, fallback = 25, max = 100) {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v <= 0) return fallback
  return Math.min(v, max)
}

export function sanitizeIlike(s) {
  return String(s || '').replace(/[%_,()]/g, ' ').trim().slice(0, 200)
}

function compactDept(d) {
  if (!d) return null
  return { id: d.id, key: d.key, name: d.name, is_primary: !!d.is_primary, source: d.source || 'explicit' }
}

export function compactStaff(row, { includeRate = false, includeSensitive = includeRate } = {}) {
  if (!row) return null
  // Two title forms: comms_title is what we say out loud (personal override
  // beats the seat's), title is the internal/formal one from the seat.
  const commsTitle = row.comms_title || row.position?.comms_title || null
  const formalTitle = row.position?.title || null
  const seatFn = row.position?.function
  const departments = Array.isArray(row.departments)
    ? row.departments.map(compactDept).filter(Boolean)
    : (seatFn ? [compactDept({ ...seatFn, is_primary: true, source: 'seat' })] : [])
  const out = {
    id: row.id,
    employee_code: row.employee_code,
    display_name: row.display_name,
    email: row.email,
    phone: row.phone,
    role: row.role,
    title: formalTitle,
    comms_title: commsTitle,
    display_title: commsTitle || formalTitle,
    position_id: row.position_id || null,
    position_code: row.position?.code || null,
    reports_to_id: row.reports_to_id || null,
    employment_type: row.employment_type,
    employment_status: row.employment_status,
    is_dummy: row.is_dummy || false,
    access_method: row.access_method || 'pin',
    home_store_id: row.home_store_id,
    home_store: row.home_store ? { id: row.home_store.id, code: row.home_store.code, name: row.home_store.name } : undefined,
    departments,
    gender: row.gender || null,
    pt_weekly_hour_cap: row.pt_weekly_hour_cap,
    pt_monthly_hour_cap: row.pt_monthly_hour_cap,
    hired_on: row.hired_on,
    terminated_on: row.terminated_on,
  }
  if (includeSensitive) {
    // Pay + statutory/CPF identity. Directory reads never carry these.
    out.hourly_rate_cents = row.hourly_rate_cents ?? null
    out.monthly_salary_cents = row.monthly_salary_cents ?? null
    out.nric = row.nric ?? null
    out.date_of_birth = row.date_of_birth ?? null
    out.race = row.race ?? null
    out.residency = row.residency ?? null
    out.nationality = row.nationality ?? null
    out.cpf_applicable = row.cpf_applicable ?? null
    out.pr_start_date = row.pr_start_date ?? null
    out.address_line_1 = row.address_line_1 ?? null
    out.address_line_2 = row.address_line_2 ?? null
    out.postal_code = row.postal_code ?? null
    out.unit_number = row.unit_number ?? null
    out.country = row.country ?? null
    out.emergency_contact_name = row.emergency_contact_name ?? null
    out.emergency_contact_phone = row.emergency_contact_phone ?? null
    out.bank_name = row.bank_name ?? null
    out.bank_account_no = row.bank_account_no ?? null
  }
  return out
}

export async function listStaff(db, workspaceId, args = {}, opts = {}) {
  const limit = clampLimit(args.limit)
  const offset = Math.max(0, Math.floor(Number(args.offset)) || 0)
  let q = db
    .from('staff')
    .select(STAFF_SELECT, { count: 'exact' })
    .eq('workspace_id', workspaceId)
    .order('employee_code')
    .range(offset, offset + limit - 1)
  if (args.role) q = q.eq('role', args.role)
  if (args.employment_type) q = q.eq('employment_type', args.employment_type)
  if (args.employment_status) q = q.eq('employment_status', args.employment_status)
  if (args.store_id) q = q.eq('home_store_id', args.store_id)
  if (args.search) {
    const s = sanitizeIlike(args.search)
    if (s) q = q.or(`display_name.ilike.%${s}%,employee_code.ilike.%${s}%,email.ilike.%${s}%`)
  }
  const { data, count, error } = await q
  if (error) throw new Error(error.message)
  const rows = await withDepartments(db, workspaceId, data || [])
  return { data: rows.map((r) => compactStaff(r, opts)), total: count || 0, limit, offset }
}

async function withDepartments(db, workspaceId, rows) {
  if (!rows.length) return rows
  const { data, error } = await db
    .from('staff_departments')
    .select('staff_id, is_primary, function:function_id(id, key, name)')
    .eq('workspace_id', workspaceId)
    .in('staff_id', rows.map((r) => r.id))
  if (error) return rows
  const byStaff = new Map()
  for (const m of data || []) {
    if (!m.function) continue
    const arr = byStaff.get(m.staff_id) || []
    arr.push({ ...m.function, is_primary: !!m.is_primary, source: 'explicit' })
    byStaff.set(m.staff_id, arr)
  }
  return rows.map((r) => {
    const explicit = byStaff.get(r.id)
    if (explicit?.length) {
      explicit.sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name))
      return { ...r, departments: explicit }
    }
    const fn = r.position?.function
    return { ...r, departments: fn ? [{ ...fn, is_primary: true, source: 'seat' }] : [] }
  })
}

/** Resolve a staff member by uuid, employee code, or (unique) name match. */
export async function resolveStaff(db, workspaceId, ref) {
  const key = String(ref || '').trim()
  if (!key) throw new Error('staff reference required (id, employee_code, or name)')
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  let q = db.from('staff').select(STAFF_SELECT).eq('workspace_id', workspaceId)
  q = isUuid ? q.eq('id', key) : q.eq('employee_code', key.toUpperCase())
  let { data, error } = await q
  if (error) throw new Error(error.message)
  if (!data?.length && !isUuid) {
    const s = sanitizeIlike(key)
    const res = await db
      .from('staff')
      .select(STAFF_SELECT)
      .eq('workspace_id', workspaceId)
      .ilike('display_name', `%${s}%`)
    if (res.error) throw new Error(res.error.message)
    data = res.data
  }
  if (!data?.length) throw new Error(`No staff found for "${key}"`)
  if (data.length > 1) {
    const names = data.map((r) => `${r.employee_code} (${r.display_name})`).join(', ')
    throw new Error(`Ambiguous staff reference "${key}" — matches: ${names}. Use the employee_code.`)
  }
  return data[0]
}

export async function resolveStore(db, workspaceId, ref) {
  const key = String(ref || '').trim()
  if (!key) return null
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  let q = db.from('stores').select('*').eq('workspace_id', workspaceId)
  q = isUuid ? q.eq('id', key) : q.eq('code', key.toUpperCase())
  const { data, error } = await q
  if (error) throw new Error(error.message)
  if (!data?.length) throw new Error(`No store found for "${key}"`)
  return data[0]
}

export async function listStores(db, workspaceId) {
  const { data, error } = await db
    .from('stores')
    .select('id, code, name, kind, address, phone, timezone, is_active')
    .eq('workspace_id', workspaceId)
    .order('code')
  if (error) throw new Error(error.message)
  return data || []
}
