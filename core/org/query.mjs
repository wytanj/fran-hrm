// Org structure + accountability queries, shared by REST and MCP.
//
// Two title forms throughout: `title` is the internal/formal one, `comms_title`
// is what we say out loud. Every projection returns both plus a resolved
// `display_title`, so a caller never has to decide which to show — and an
// agent writing a message uses the comms title without being told.
//
// Hierarchy is fetched flat and assembled in JS rather than with a recursive
// CTE: PostgREST cannot express one, and org charts are small enough that the
// round trip is cheaper than a database function to maintain.

/** Comms title wins for anything human-facing; formal title is the fallback. */
export function displayTitle(row) {
  return row?.comms_title || row?.title || null
}

export function compactPosition(row) {
  if (!row) return null
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    comms_title: row.comms_title || null,
    display_title: displayTitle(row),
    purpose: row.purpose || null,
    function: row.function ? { key: row.function.key, name: row.function.name } : undefined,
    function_id: row.function_id || null,
    reports_to_id: row.reports_to_id || null,
    expected_role: row.expected_role || null,
    is_leadership: !!row.is_leadership,
    headcount: row.headcount ?? 1,
    store_id: row.store_id || null,
    is_active: row.is_active !== false,
  }
}

/** A person's title: their own override, else their seat's. */
export function staffTitles(staff) {
  const seat = staff?.position || null
  const comms = staff?.comms_title || seat?.comms_title || null
  const formal = seat?.title || null
  return {
    title: formal,
    comms_title: comms,
    display_title: comms || formal || null,
  }
}

export function compactStaffOrg(staff) {
  if (!staff) return null
  const titles = staffTitles(staff)
  return {
    id: staff.id,
    employee_code: staff.employee_code,
    display_name: staff.display_name,
    role: staff.role,
    employment_type: staff.employment_type,
    employment_status: staff.employment_status,
    position_id: staff.position_id || null,
    position_code: staff.position?.code || null,
    ...titles,
    reports_to_id: staff.reports_to_id || null,
    store_id: staff.home_store_id || null,
  }
}

const POSITION_COLS = 'id, code, title, comms_title, function_id, reports_to_id, purpose, expected_role, is_leadership, headcount, store_id, is_active, sort_order, function:function_id(key, name)'
const STAFF_ORG_COLS = 'id, employee_code, display_name, role, employment_type, employment_status, position_id, reports_to_id, comms_title, home_store_id, position:position_id(id, code, title, comms_title, reports_to_id)'

export async function listFunctions(db, workspaceId) {
  const { data, error } = await db
    .from('org_functions').select('id, key, name, description, sort_order')
    .eq('workspace_id', workspaceId).order('sort_order')
  if (error) throw new Error(error.message)
  return data || []
}

export async function listPositions(db, workspaceId, { include_inactive = false } = {}) {
  let q = db.from('positions').select(POSITION_COLS).eq('workspace_id', workspaceId).order('sort_order')
  if (!include_inactive) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []).map(compactPosition)
}

export async function listStaffOrg(db, workspaceId, { include_inactive = false } = {}) {
  let q = db.from('staff').select(STAFF_ORG_COLS).eq('workspace_id', workspaceId).order('employee_code')
  if (!include_inactive) q = q.eq('employment_status', 'active')
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []).map(compactStaffOrg)
}

/**
 * Resolve a staff member's manager.
 *
 * Explicit staff.reports_to_id wins (covers interim arrangements and vacant
 * seats). Otherwise follow the seat's reporting line to whoever holds that
 * seat. A seat with several holders is reported as ambiguous rather than
 * guessed at — picking one silently would make a 1:1 scheduler pair people
 * with the wrong manager.
 */
export function resolveManager(staffMember, allStaff, allPositions) {
  if (!staffMember) return { manager: null, source: 'none' }

  if (staffMember.reports_to_id) {
    const direct = allStaff.find((s) => s.id === staffMember.reports_to_id)
    if (direct) return { manager: direct, source: 'explicit' }
  }

  const seat = allPositions.find((p) => p.id === staffMember.position_id)
  if (!seat?.reports_to_id) return { manager: null, source: seat ? 'top_of_chart' : 'no_position' }

  const holders = allStaff.filter((s) => s.position_id === seat.reports_to_id)
  const managerSeat = allPositions.find((p) => p.id === seat.reports_to_id)
  if (!holders.length) {
    return { manager: null, source: 'vacant_seat', vacant_position: managerSeat ? compactPosition(managerSeat) : null }
  }
  if (holders.length > 1) {
    return { manager: holders[0], source: 'position_ambiguous', candidates: holders }
  }
  return { manager: holders[0], source: 'position' }
}

/** Direct reports: explicit reporting lines plus seat-derived ones. */
export function resolveDirectReports(staffMember, allStaff, allPositions) {
  if (!staffMember) return []
  const out = new Map()

  for (const s of allStaff) {
    if (s.id === staffMember.id) continue
    if (s.reports_to_id === staffMember.id) { out.set(s.id, s); continue }
    // Seat-derived, but only when the person has no explicit override.
    if (s.reports_to_id) continue
    const seat = allPositions.find((p) => p.id === s.position_id)
    if (seat?.reports_to_id && seat.reports_to_id === staffMember.position_id) out.set(s.id, s)
  }
  return [...out.values()]
}

/** Everyone below someone, breadth-first. Cycle-safe via the visited set. */
export function resolveAllReports(staffMember, allStaff, allPositions) {
  const seen = new Set([staffMember?.id])
  const out = []
  let frontier = resolveDirectReports(staffMember, allStaff, allPositions)
  let depth = 1
  while (frontier.length && depth < 20) {
    const next = []
    for (const person of frontier) {
      if (seen.has(person.id)) continue
      seen.add(person.id)
      out.push({ ...person, depth })
      next.push(...resolveDirectReports(person, allStaff, allPositions))
    }
    frontier = next
    depth += 1
  }
  return out
}

/** Upward chain to the top of the chart. */
export function resolveReportingChain(staffMember, allStaff, allPositions) {
  const chain = []
  const seen = new Set([staffMember?.id])
  let current = staffMember
  while (current && chain.length < 20) {
    const { manager, source } = resolveManager(current, allStaff, allPositions)
    if (!manager || seen.has(manager.id)) break
    seen.add(manager.id)
    chain.push({ ...manager, via: source })
    current = manager
  }
  return chain
}

/**
 * The org chart as a tree of seats, each with its holders. Seats whose parent
 * is missing are attached at the root so nothing disappears from the chart.
 */
export function buildOrgTree(positions, staff) {
  const holdersBySeat = new Map()
  for (const s of staff) {
    if (!s.position_id) continue
    const list = holdersBySeat.get(s.position_id) || []
    list.push(s)
    holdersBySeat.set(s.position_id, list)
  }

  const nodes = new Map(
    positions.map((p) => [p.id, {
      ...p,
      holders: holdersBySeat.get(p.id) || [],
      vacancies: Math.max(0, (p.headcount ?? 1) - (holdersBySeat.get(p.id)?.length || 0)),
      children: [],
    }]),
  )

  const roots = []
  for (const node of nodes.values()) {
    const parent = node.reports_to_id ? nodes.get(node.reports_to_id) : null
    if (parent && parent !== node) parent.children.push(node)
    else roots.push(node)
  }

  const sortTree = (list) => {
    list.sort((a, b) => (a.sort_order ?? 100) - (b.sort_order ?? 100) || a.title.localeCompare(b.title))
    for (const n of list) sortTree(n.children)
  }
  sortTree(roots)

  const unassigned = staff.filter((s) => !s.position_id)
  return { roots, unassigned, seat_count: positions.length, filled: staff.filter((s) => s.position_id).length }
}

/** Would setting reports_to create a loop? Checked before any seat update. */
export function wouldCreateCycle(positions, positionId, newParentId) {
  if (!newParentId) return false
  if (positionId === newParentId) return true
  const byId = new Map(positions.map((p) => [p.id, p]))
  let cursor = byId.get(newParentId)
  let hops = 0
  while (cursor && hops < 50) {
    if (cursor.id === positionId) return true
    cursor = cursor.reports_to_id ? byId.get(cursor.reports_to_id) : null
    hops += 1
  }
  return false
}

// ---------------------------------------------------------------------------
// Accountabilities
// ---------------------------------------------------------------------------

const ACC_COLS = `id, key, name, outcome, function_id, owner_position_id, owner_staff_id,
  metric_name, metric_target, metric_unit, cadence, status, store_id, notes, sort_order, updated_at,
  function:function_id(key, name),
  owner_position:owner_position_id(id, code, title, comms_title),
  owner_staff:owner_staff_id(id, employee_code, display_name, comms_title)`

/**
 * Resolve the single accountable human. owner_staff_id wins; otherwise the
 * holder(s) of the owning seat. Unfilled or multiply-filled seats are reported
 * honestly — an accountability nobody can be named for is the thing a manager
 * most needs to see.
 */
function resolveOwner(acc, staffBySeat) {
  if (acc.owner_staff) {
    return {
      owner_kind: 'person',
      owner_name: acc.owner_staff.display_name,
      owner_staff_id: acc.owner_staff.id,
      owner_employee_code: acc.owner_staff.employee_code,
      owner_resolved: true,
    }
  }
  const holders = acc.owner_position_id ? (staffBySeat.get(acc.owner_position_id) || []) : []
  const seatLabel = acc.owner_position
    ? displayTitle(acc.owner_position)
    : null
  if (holders.length === 1) {
    return {
      owner_kind: 'seat',
      owner_seat: seatLabel,
      owner_name: holders[0].display_name,
      owner_staff_id: holders[0].id,
      owner_employee_code: holders[0].employee_code,
      owner_resolved: true,
    }
  }
  if (holders.length > 1) {
    return {
      owner_kind: 'seat',
      owner_seat: seatLabel,
      owner_name: null,
      owner_resolved: false,
      owner_warning: `Seat "${seatLabel}" has ${holders.length} holders — nobody is uniquely accountable. Set owner_staff_id, or split the seat.`,
      owner_candidates: holders.map((h) => `${h.display_name} (${h.employee_code})`),
    }
  }
  return {
    owner_kind: 'seat',
    owner_seat: seatLabel,
    owner_name: null,
    owner_resolved: false,
    owner_warning: seatLabel
      ? `Seat "${seatLabel}" is vacant — this accountability currently has no owner.`
      : 'No owner seat or person is set.',
  }
}

export function compactAccountability(acc, staffBySeat) {
  if (!acc) return null
  return {
    key: acc.key,
    name: acc.name,
    outcome: acc.outcome || null,
    function: acc.function?.name || null,
    status: acc.status,
    cadence: acc.cadence,
    metric: acc.metric_name
      ? { name: acc.metric_name, target: acc.metric_target == null ? null : Number(acc.metric_target), unit: acc.metric_unit || null }
      : null,
    store_id: acc.store_id || null,
    notes: acc.notes || null,
    ...resolveOwner(acc, staffBySeat),
    id: acc.id,
  }
}

async function staffBySeatMap(db, workspaceId) {
  const { data } = await db
    .from('staff').select('id, employee_code, display_name, position_id')
    .eq('workspace_id', workspaceId).eq('employment_status', 'active')
  const map = new Map()
  for (const s of data || []) {
    if (!s.position_id) continue
    const list = map.get(s.position_id) || []
    list.push(s)
    map.set(s.position_id, list)
  }
  return map
}

export async function listAccountabilities(db, workspaceId, args = {}) {
  let q = db.from('accountabilities').select(ACC_COLS).eq('workspace_id', workspaceId).order('sort_order')
  if (args.status) q = q.eq('status', args.status)
  else q = q.neq('status', 'retired')
  if (args.function_key) {
    const { data: fn } = await db.from('org_functions').select('id')
      .eq('workspace_id', workspaceId).eq('key', args.function_key).maybeSingle()
    if (fn) q = q.eq('function_id', fn.id)
  }
  if (args.store_id) q = q.eq('store_id', args.store_id)
  const { data, error } = await q
  if (error) throw new Error(error.message)

  const seatMap = await staffBySeatMap(db, workspaceId)
  let rows = (data || []).map((a) => compactAccountability(a, seatMap))

  // Filter by owner after resolution, since the owner may come from the seat.
  if (args.owner_staff_id) rows = rows.filter((r) => r.owner_staff_id === args.owner_staff_id)
  if (args.unowned_only) rows = rows.filter((r) => !r.owner_resolved)
  return rows
}

/**
 * "Who owns X?" — keyword search across name, outcome, metric and key.
 * Deliberately scored rather than an ilike: the question is usually phrased in
 * the asker's words, not the register's.
 */
export async function searchAccountabilities(db, workspaceId, query, { limit = 5 } = {}) {
  const rows = await listAccountabilities(db, workspaceId, {})
  const tokens = String(query || '').toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/)
    .filter((t) => t.length >= 3 && !['who', 'owns', 'the', 'for', 'and', 'what', 'accountable', 'responsible', 'charge'].includes(t))

  if (!tokens.length) return { query, matches: rows.slice(0, limit), note: 'No searchable terms — returning the register.' }

  const scored = rows.map((r) => {
    const name = r.name.toLowerCase()
    const outcome = (r.outcome || '').toLowerCase()
    const key = r.key.toLowerCase()
    const metric = (r.metric?.name || '').toLowerCase()
    let score = 0
    for (const t of tokens) {
      if (name.includes(t)) score += 4
      if (key.includes(t)) score += 3
      if (metric.includes(t)) score += 2
      if (outcome.includes(t)) score += 2
      if ((r.function || '').toLowerCase().includes(t)) score += 1
    }
    return { ...r, score }
  }).filter((r) => r.score > 0).sort((a, b) => b.score - a.score).slice(0, limit)

  return {
    query,
    matches: scored,
    needs_clarification: scored.length === 0,
    note: scored.length
      ? undefined
      : 'Nothing in the accountability register matched. List all accountabilities rather than guessing an owner.',
  }
}

export async function getAccountability(db, workspaceId, key) {
  const raw = String(key || '').trim()
  if (!raw) throw new Error('key is required')
  const { data, error } = await db.from('accountabilities').select(ACC_COLS)
    .eq('workspace_id', workspaceId).or(`key.eq.${raw},id.eq.${/^[0-9a-f-]{36}$/i.test(raw) ? raw : '00000000-0000-0000-0000-000000000000'}`)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { found: false, key: raw, message: `No accountability "${raw}". Call accountability_list for the register.` }

  const seatMap = await staffBySeatMap(db, workspaceId)
  const [{ data: contributors }, { data: checkins }] = await Promise.all([
    db.from('accountability_contributors')
      .select('role, staff:staff_id(employee_code, display_name), position:position_id(code, title, comms_title)')
      .eq('accountability_id', data.id),
    db.from('accountability_checkins')
      .select('period_start, period_end, metric_value, status, note, created_at')
      .eq('accountability_id', data.id).order('period_start', { ascending: false }).limit(12),
  ])

  return {
    found: true,
    ...compactAccountability(data, seatMap),
    contributors: (contributors || []).map((c) => ({
      role: c.role,
      who: c.staff ? `${c.staff.display_name} (${c.staff.employee_code})` : (c.position ? displayTitle(c.position) : null),
    })),
    recent_checkins: (checkins || []).map((c) => ({
      period_start: c.period_start,
      period_end: c.period_end,
      metric_value: c.metric_value == null ? null : Number(c.metric_value),
      status: c.status,
      note: c.note,
    })),
  }
}

/** Everything one person is accountable for, seat-derived included. */
export async function accountabilitiesForStaff(db, workspaceId, staffMember) {
  const rows = await listAccountabilities(db, workspaceId, {})
  return rows.filter((r) => r.owner_staff_id === staffMember.id)
}
