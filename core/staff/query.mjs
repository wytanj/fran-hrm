// Staff directory queries shared by REST + MCP. Compact projections and
// clamped limits — agent surfaces get exact counts, never full dumps.
// hourly_rate_cents is stripped unless opts.includeRate (area_manager+ only).

export function clampLimit(n, fallback = 25, max = 100) {
  const v = Math.floor(Number(n))
  if (!Number.isFinite(v) || v <= 0) return fallback
  return Math.min(v, max)
}

export function sanitizeIlike(s) {
  return String(s || '').replace(/[%_,()]/g, ' ').trim().slice(0, 200)
}

export function compactStaff(row, { includeRate = false } = {}) {
  if (!row) return null
  // Two title forms: comms_title is what we say out loud (personal override
  // beats the seat's), title is the internal/formal one from the seat.
  const commsTitle = row.comms_title || row.position?.comms_title || null
  const formalTitle = row.position?.title || null
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
    pt_weekly_hour_cap: row.pt_weekly_hour_cap,
    pt_monthly_hour_cap: row.pt_monthly_hour_cap,
    hired_on: row.hired_on,
    terminated_on: row.terminated_on,
  }
  if (includeRate) {
    // Sensitive: pay + statutory/CPF identity. Same gate as pay rate
    // (area_manager+), so NRIC/DOB/address never ride a general staff read.
    out.hourly_rate_cents = row.hourly_rate_cents
    out.nric = row.nric ?? null
    out.date_of_birth = row.date_of_birth ?? null
    out.postal_code = row.postal_code ?? null
    out.unit_number = row.unit_number ?? null
  }
  return out
}

export async function listStaff(db, workspaceId, args = {}, opts = {}) {
  const limit = clampLimit(args.limit)
  const offset = Math.max(0, Math.floor(Number(args.offset)) || 0)
  let q = db
    .from('staff')
    .select('*, home_store:home_store_id(id, code, name), position:position_id(code, title, comms_title)', { count: 'exact' })
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
  return { data: (data || []).map((r) => compactStaff(r, opts)), total: count || 0, limit, offset }
}

/** Resolve a staff member by uuid, employee code, or (unique) name match. */
export async function resolveStaff(db, workspaceId, ref) {
  const key = String(ref || '').trim()
  if (!key) throw new Error('staff reference required (id, employee_code, or name)')
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  let q = db.from('staff').select('*, home_store:home_store_id(id, code, name), position:position_id(code, title, comms_title)').eq('workspace_id', workspaceId)
  q = isUuid ? q.eq('id', key) : q.eq('employee_code', key.toUpperCase())
  let { data, error } = await q
  if (error) throw new Error(error.message)
  if (!data?.length && !isUuid) {
    const s = sanitizeIlike(key)
    const res = await db
      .from('staff')
      .select('*, home_store:home_store_id(id, code, name), position:position_id(code, title, comms_title)')
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
