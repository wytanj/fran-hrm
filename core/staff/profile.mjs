// Staff profile reads/writes shared by REST and MCP.
//
// Directory fields + titles + departments + hierarchy are staff:read.
// Pay, citizenship, race, address, NRIC ride includeSensitive
// (reports:cost or staff:write). The field catalog in fields.mjs decides
// which is which so a new column does not need a second permission list.

import { recordAudit } from '../audit/record.mjs'
import {
  accountabilitiesForStaff,
  compactPosition,
  listPositions,
  listStaffOrg,
  resolveDirectReports,
  resolveManager,
  resolveReportingChain,
} from '../org/query.mjs'
import {
  BUILT_IN_BY_KEY,
  BUILT_IN_FIELDS,
  canSeeSensitivity,
  coerceFieldValue,
  customRowAsField,
  describeBuiltInField,
  describeCustomField,
  optionLabel,
  parseCustomValue,
  pickCatalogInput,
  serializeCustomValue,
  validateCustomFieldDef,
} from './fields.mjs'
import { compactStaff, resolveStaff, resolveStore, STAFF_SELECT } from './query.mjs'

export function canSeeSensitiveFields(has) {
  if (typeof has === 'function') return has('reports:cost') || has('staff:write')
  if (has == null) return true
  if (Array.isArray(has)) return has.includes('reports:cost') || has.includes('staff:write')
  return false
}

function actorPayload(actor = {}) {
  return {
    workspace_id: actor.workspace_id,
    actor_kind: actor.actor_kind || 'user',
    actor_id: actor.actor_id || null,
    actor_name: actor.actor_name || null,
    source_type: actor.source_type || 'web',
  }
}

function compactPerson(s) {
  if (!s) return null
  return {
    id: s.id,
    employee_code: s.employee_code,
    display_name: s.display_name,
    display_title: s.display_title || s.comms_title || s.title || null,
    title: s.title || null,
    comms_title: s.comms_title || null,
    role: s.role,
    employment_type: s.employment_type,
  }
}

export async function listCustomFields(db, workspaceId, { includeInactive = false } = {}) {
  let q = db.from('staff_profile_fields')
    .select('id, key, label, description, field_type, field_group, sensitivity, options, required, sort_order, is_active, updated_at')
    .eq('workspace_id', workspaceId)
    .order('sort_order')
  if (!includeInactive) q = q.eq('is_active', true)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

export async function listCatalog(db, workspaceId, { includeSensitive = false, includeInactive = false } = {}) {
  const custom = await listCustomFields(db, workspaceId, { includeInactive })
  return [
    ...BUILT_IN_FIELDS.map((f) => describeBuiltInField(f, { includeSensitive })),
    ...custom.map((r) => describeCustomField(r, { includeSensitive })),
  ]
}

async function loadDepartmentRows(db, workspaceId, staffIds) {
  if (!staffIds.length) return []
  const { data, error } = await db
    .from('staff_departments')
    .select('staff_id, is_primary, function:function_id(id, key, name)')
    .eq('workspace_id', workspaceId)
    .in('staff_id', staffIds)
  if (error) throw new Error(error.message)
  return data || []
}

function projectDepartments(staffRow, memberships) {
  const explicit = (memberships || [])
    .filter((m) => m.function)
    .map((m) => ({
      id: m.function.id,
      key: m.function.key,
      name: m.function.name,
      is_primary: !!m.is_primary,
      source: 'explicit',
    }))
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.name.localeCompare(b.name))
  if (explicit.length) return explicit
  const fn = staffRow?.position?.function
  if (fn) {
    return [{ id: fn.id, key: fn.key, name: fn.name, is_primary: true, source: 'seat' }]
  }
  return []
}

export async function attachDepartments(db, workspaceId, rows) {
  const list = Array.isArray(rows) ? rows : []
  const memberships = await loadDepartmentRows(db, workspaceId, list.map((r) => r.id).filter(Boolean))
  const byStaff = new Map()
  for (const m of memberships) {
    const arr = byStaff.get(m.staff_id) || []
    arr.push(m)
    byStaff.set(m.staff_id, arr)
  }
  return list.map((row) => ({
    ...row,
    departments: projectDepartments(row, byStaff.get(row.id) || []),
  }))
}

async function loadCustomValues(db, workspaceId, staffId, customFields, { includeSensitive = false } = {}) {
  if (!customFields.length) return { values: {}, projected: [] }
  const { data, error } = await db
    .from('staff_profile_values')
    .select('field_id, value_text')
    .eq('workspace_id', workspaceId)
    .eq('staff_id', staffId)
  if (error) throw new Error(error.message)
  const byField = new Map((data || []).map((v) => [v.field_id, v.value_text]))
  const values = {}
  const projected = []
  for (const row of customFields) {
    const field = customRowAsField(row)
    const visible = canSeeSensitivity(field.sensitivity, { includeSensitive })
    const parsed = parseCustomValue(field, byField.get(row.id) ?? null)
    if (visible) values[row.key] = parsed
    projected.push({
      ...describeCustomField(row, { includeSensitive }),
      value: visible ? parsed : null,
      display: visible ? formatDisplay(field, parsed) : null,
    })
  }
  return { values, projected }
}

function formatDisplay(field, value) {
  if (value == null || value === '') return null
  if (field.type === 'boolean' || field.field_type === 'boolean') return value ? 'Yes' : 'No'
  if (field.type === 'money_cents' || field.field_type === 'money_cents') {
    const v = (Number(value) || 0) / 100
    return `S$${v.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }
  if (field.options?.length) return optionLabel(field, value) || String(value)
  return String(value)
}

function formatAddress(row) {
  const parts = [
    row.address_line_1,
    row.address_line_2,
    row.unit_number,
    row.postal_code,
    row.country || (row.postal_code || row.address_line_1 ? 'Singapore' : null),
  ].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

async function buildHierarchy(db, workspaceId, staffRow) {
  const [positions, staff] = await Promise.all([
    listPositions(db, workspaceId, { include_inactive: true }),
    listStaffOrg(db, workspaceId, { include_inactive: true }),
  ])
  const me = staff.find((s) => s.id === staffRow.id) || null
  if (!me) {
    return {
      manager: null,
      manager_source: 'none',
      manager_warning: 'This person is not on the org chart (inactive or unseated).',
      direct_reports: [],
      reporting_chain: [],
      accountabilities: [],
      seat: null,
    }
  }
  const seat = positions.find((p) => p.id === me.position_id) || (staffRow.position ? compactPosition({
    ...staffRow.position,
    function: staffRow.position.function,
  }) : null)
  const managerInfo = resolveManager(me, staff, positions)
  const warning = managerInfo.source === 'vacant_seat'
    ? `Reports into a vacant seat${managerInfo.vacant_position ? ` (${managerInfo.vacant_position.display_title})` : ''} — set an interim manager on the staff record.`
    : managerInfo.source === 'position_ambiguous'
      ? 'The manager seat has several holders; set reports_to on the staff record to disambiguate.'
      : null
  return {
    manager: compactPerson(managerInfo.manager),
    manager_source: managerInfo.source,
    manager_warning: warning,
    direct_reports: resolveDirectReports(me, staff, positions).map(compactPerson),
    reporting_chain: resolveReportingChain(me, staff, positions).map((p) => ({
      ...compactPerson(p),
      via: p.via,
    })),
    accountabilities: await accountabilitiesForStaff(db, workspaceId, me),
    seat,
  }
}

function projectBuiltInFields(row, { includeSensitive = false } = {}) {
  return BUILT_IN_FIELDS.map((f) => {
    const visible = canSeeSensitivity(f.sensitivity, { includeSensitive })
    const raw = visible ? (row[f.column] ?? null) : null
    return {
      ...describeBuiltInField(f, { includeSensitive }),
      value: raw,
      display: visible ? formatDisplay(f, raw) : null,
    }
  })
}

export async function getStaffProfile(db, workspaceId, ref, { includeSensitive = false } = {}) {
  const row = await resolveStaff(db, workspaceId, ref)
  const [withDepts, customFields, hierarchy] = await Promise.all([
    attachDepartments(db, workspaceId, [row]),
    listCustomFields(db, workspaceId, { includeInactive: false }),
    buildHierarchy(db, workspaceId, row),
  ])
  const decorated = withDepts[0]
  const custom = await loadCustomValues(db, workspaceId, row.id, customFields, { includeSensitive })
  const builtInProjected = projectBuiltInFields(row, { includeSensitive })
  const staff = compactStaff(row, { includeRate: includeSensitive, includeSensitive })
  staff.departments = decorated.departments
  staff.citizenship = includeSensitive ? row.residency || null : undefined
  staff.citizenship_label = includeSensitive ? optionLabel(BUILT_IN_BY_KEY.residency, row.residency) : undefined
  staff.home_address = includeSensitive ? formatAddress(row) : undefined
  return {
    ...staff,
    gender: row.gender || null,
    departments: decorated.departments,
    hierarchy,
    seat: hierarchy.seat,
    fields: [...builtInProjected, ...custom.projected],
    custom: custom.values,
    include_sensitive: includeSensitive,
  }
}

export async function resolveFunctionRef(db, workspaceId, ref) {
  const key = String(ref || '').trim()
  if (!key) throw new Error('department reference required (function key or id)')
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  let q = db.from('org_functions').select('id, key, name').eq('workspace_id', workspaceId)
  q = isUuid ? q.eq('id', key) : q.eq('key', key)
  const { data, error } = await q.maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error(`No department/function "${key}". Use a function key (retail_ops, marketing, people, finance, leadership).`)
  return data
}

async function resolvePositionRef(db, workspaceId, ref) {
  if (ref === null || ref === '') return null
  const key = String(ref).trim()
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  let q = db.from('positions').select('id, code, title, comms_title, function_id').eq('workspace_id', workspaceId)
  q = isUuid ? q.eq('id', key) : q.eq('code', key.toUpperCase())
  const { data, error } = await q.maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error(`No seat/position "${key}". Use the position code (e.g. SM, BA, FOUNDER).`)
  return data
}

function normalizeDepartmentInput(raw) {
  if (raw === undefined) return undefined
  if (raw === null) return []
  if (!Array.isArray(raw)) throw new Error('departments must be an array of function keys, or [{ key, is_primary }]')
  return raw.map((item, i) => {
    if (typeof item === 'string') return { ref: item, is_primary: i === 0 }
    if (!item || typeof item !== 'object') throw new Error('each department must be a function key or { key, is_primary }')
    return { ref: item.key || item.function_id || item.id, is_primary: !!item.is_primary }
  })
}

export async function setStaffDepartments(db, workspaceId, staffId, spec) {
  const items = normalizeDepartmentInput(spec)
  if (items === undefined) return
  const resolved = []
  const seen = new Set()
  for (const item of items) {
    const fn = await resolveFunctionRef(db, workspaceId, item.ref)
    if (seen.has(fn.id)) continue
    seen.add(fn.id)
    resolved.push({ ...fn, is_primary: item.is_primary })
  }
  if (resolved.length && !resolved.some((r) => r.is_primary)) resolved[0].is_primary = true
  // Unique index allows only one primary — clear first, then insert.
  const { error: delErr } = await db.from('staff_departments')
    .delete().eq('workspace_id', workspaceId).eq('staff_id', staffId)
  if (delErr) throw new Error(delErr.message)
  if (!resolved.length) return
  const { error } = await db.from('staff_departments').insert(
    resolved.map((r) => ({
      workspace_id: workspaceId,
      staff_id: staffId,
      function_id: r.id,
      is_primary: !!r.is_primary,
    })),
  )
  if (error) throw new Error(error.message)
}

async function applyCustomValues(db, workspaceId, staffId, customInput) {
  if (!customInput || !Object.keys(customInput).length) return
  const fields = await listCustomFields(db, workspaceId, { includeInactive: true })
  const byKey = new Map(fields.map((f) => [f.key, f]))
  for (const [key, raw] of Object.entries(customInput)) {
    const def = byKey.get(key)
    if (!def) {
      throw new Error(`Unknown custom field "${key}". Call staff_fields_list (or GET /api/v1/staff/profile-fields) for the catalog, or create it first.`)
    }
    if (def.is_active === false) throw new Error(`Custom field "${key}" is inactive.`)
    const field = customRowAsField(def)
    const stored = raw === null || raw === '' ? null : serializeCustomValue(field, raw)
    if (stored == null) {
      await db.from('staff_profile_values')
        .delete().eq('workspace_id', workspaceId).eq('staff_id', staffId).eq('field_id', def.id)
      continue
    }
    const { error } = await db.from('staff_profile_values').upsert({
      workspace_id: workspaceId,
      staff_id: staffId,
      field_id: def.id,
      value_text: stored,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'staff_id,field_id' })
    if (error) throw new Error(error.message)
  }
}

async function coerceBuiltInPatch(db, workspaceId, builtIn, { isCreate = false, current = null } = {}) {
  const patch = {}
  for (const [key, raw] of Object.entries(builtIn)) {
    const field = BUILT_IN_BY_KEY[key]
    if (!field) continue
    if (field.writable === false && !isCreate && !field.createOnly) continue
    if (field.createOnly && !isCreate) continue
    if (raw === null || raw === '') {
      patch[field.column] = null
      continue
    }
    if (field.type === 'store_ref') {
      const store = await resolveStore(db, workspaceId, raw)
      patch[field.column] = store.id
      continue
    }
    if (field.type === 'position_ref') {
      const pos = await resolvePositionRef(db, workspaceId, raw)
      patch[field.column] = pos ? pos.id : null
      continue
    }
    if (field.type === 'staff_ref') {
      const person = await resolveStaff(db, workspaceId, raw)
      patch[field.column] = person.id
      continue
    }
    if (key === 'nric') {
      patch[field.column] = String(raw).trim().toUpperCase()
      continue
    }
    if (key === 'email') {
      patch[field.column] = String(raw).trim().toLowerCase()
      continue
    }
    patch[field.column] = coerceFieldValue(field, raw)
  }
  if (patch.reports_to_id) {
    const targetId = current?.id
    if (targetId && patch.reports_to_id === targetId) {
      throw new Error('A person cannot report to themselves.')
    }
    if (targetId) {
      const [orgStaff, positions] = await Promise.all([
        listStaffOrg(db, workspaceId, { include_inactive: true }),
        listPositions(db, workspaceId, { include_inactive: true }),
      ])
      const simulated = orgStaff.map((s) => (s.id === targetId ? { ...s, reports_to_id: patch.reports_to_id } : s))
      let cursor = simulated.find((s) => s.id === targetId)
      const seen = new Set([targetId])
      for (let hops = 0; hops < 20 && cursor; hops++) {
        const { manager } = resolveManager(cursor, simulated, positions)
        if (!manager) break
        if (seen.has(manager.id)) {
          throw new Error('That reporting line would create a loop (including seat-derived managers). Pick a different manager.')
        }
        seen.add(manager.id)
        cursor = simulated.find((s) => s.id === manager.id)
      }
    }
  }
  return patch
}

async function maybeAssignSeatDepartment(db, workspaceId, staffId, positionId) {
  if (!positionId) return
  const { data: existing } = await db.from('staff_departments')
    .select('id').eq('workspace_id', workspaceId).eq('staff_id', staffId).limit(1)
  if (existing?.length) return
  const { data: pos } = await db.from('positions')
    .select('function_id').eq('workspace_id', workspaceId).eq('id', positionId).maybeSingle()
  if (pos?.function_id) {
    await setStaffDepartments(db, workspaceId, staffId, [{ key: pos.function_id, is_primary: true }])
  }
}

export async function createStaffRecord(db, workspaceId, input, actor = {}) {
  const picked = pickCatalogInput(input)
  const name = String(picked.display_name || picked.builtIn.display_name || '').trim()
  if (!name) throw new Error('display_name is required')

  const patch = await coerceBuiltInPatch(db, workspaceId, {
    ...picked.builtIn,
    display_name: name,
  }, { isCreate: true })

  const isDummy = !!picked.is_dummy
  const rawCode = String(picked.employee_code || picked.builtIn.employee_code || '').trim()
  const { randomBytes } = await import('node:crypto')
  const code = (rawCode || `${isDummy ? 'DUMMY' : 'EMP'}-${randomBytes(2).toString('hex').toUpperCase()}`).toUpperCase()

  const insert = {
    workspace_id: workspaceId,
    employee_code: code,
    display_name: name,
    is_dummy: isDummy,
    access_method: patch.access_method || 'pin',
    role: patch.role || 'staff',
    employment_type: patch.employment_type || 'full_time',
    employment_status: patch.employment_status || 'active',
    cpf_applicable: patch.cpf_applicable === undefined ? true : patch.cpf_applicable,
    ...patch,
  }
  if (input.pin_hash) insert.pin_hash = input.pin_hash

  const { data, error } = await db.from('staff').insert(insert).select(STAFF_SELECT).single()
  if (error) throw new Error(error.message)

  if (data.home_store_id) {
    await db.from('staff_store_assignments').insert({
      workspace_id: workspaceId, staff_id: data.id, store_id: data.home_store_id, is_primary: true,
    })
  }

  const depts = normalizeDepartmentInput(picked.departments)
  if (depts !== undefined) {
    await setStaffDepartments(db, workspaceId, data.id, picked.departments)
  } else {
    await maybeAssignSeatDepartment(db, workspaceId, data.id, data.position_id)
  }
  await applyCustomValues(db, workspaceId, data.id, picked.custom)

  const profile = await getStaffProfile(db, workspaceId, data.id, { includeSensitive: true })
  await recordAudit(db, {
    ...actorPayload({ ...actor, workspace_id: workspaceId }),
    object_type: 'staff', entity_id: data.id, operation: 'INSERT',
    after_data: compactStaff(data, { includeSensitive: true }),
  })
  return profile
}

export async function updateStaffRecord(db, workspaceId, ref, input, actor = {}) {
  const before = await resolveStaff(db, workspaceId, ref)
  const picked = pickCatalogInput(input)
  const patch = await coerceBuiltInPatch(db, workspaceId, picked.builtIn, { current: before })

  if (['terminated', 'inactive'].includes(patch.employment_status)) {
    patch.pos_access_enabled = false
    if (patch.employment_status === 'terminated' && patch.terminated_on === undefined && !before.terminated_on) {
      patch.terminated_on = new Date().toISOString().slice(0, 10)
    }
  }
  if (input.pin_hash) {
    patch.pin_hash = input.pin_hash
    patch.failed_attempts = 0
    patch.locked_until = null
  }
  patch.updated_at = new Date().toISOString()

  let row = before
  if (Object.keys(patch).length > 1) { // updated_at always present
    const { data, error } = await db.from('staff')
      .update(patch).eq('workspace_id', workspaceId).eq('id', before.id)
      .select(STAFF_SELECT).single()
    if (error) throw new Error(error.message)
    row = data
  }

  if (picked.departments !== undefined) {
    await setStaffDepartments(db, workspaceId, before.id, picked.departments)
  }
  await applyCustomValues(db, workspaceId, before.id, picked.custom)

  const profile = await getStaffProfile(db, workspaceId, before.id, { includeSensitive: true })
  await recordAudit(db, {
    ...actorPayload({ ...actor, workspace_id: workspaceId }),
    object_type: 'staff', entity_id: before.id, operation: 'UPDATE',
    before_data: compactStaff(before, { includeSensitive: true }),
    after_data: compactStaff(row, { includeSensitive: true }),
  })
  return profile
}

export async function deleteStaffRecord(db, workspaceId, ref, { actor = {}, mode = 'auto' } = {}) {
  const st = await resolveStaff(db, workspaceId, ref)
  const wantPurge = mode === 'purge' || mode === 'legacy' || (mode === 'auto' && st.is_dummy)
  if (wantPurge) {
    if (!st.is_dummy) {
      throw new Error('Only dummy (test) staff can be purged. Real staff are terminated so their timesheets and the audit trail survive. Pass mode=terminate, or use Edit → Terminate on Team.')
    }
    await db.from('shifts').delete().eq('workspace_id', workspaceId).eq('staff_id', st.id)
    const { error } = await db.from('staff').delete()
      .eq('workspace_id', workspaceId).eq('id', st.id).eq('is_dummy', true)
    if (error) throw new Error(error.message)
    await recordAudit(db, {
      ...actorPayload({ ...actor, workspace_id: workspaceId }),
      object_type: 'staff', entity_id: st.id, operation: 'DELETE',
      before_data: { employee_code: st.employee_code, display_name: st.display_name, is_dummy: true },
      metadata: { action: 'purge_dummy_staff' },
    })
    return { ok: true, action: 'purged', employee_code: st.employee_code, display_name: st.display_name }
  }

  if (st.employment_status === 'terminated') {
    return { ok: true, action: 'already_terminated', employee_code: st.employee_code, display_name: st.display_name }
  }
  const today = new Date().toISOString().slice(0, 10)
  const { data, error } = await db.from('staff').update({
    employment_status: 'terminated',
    terminated_on: st.terminated_on || today,
    pos_access_enabled: false,
    updated_at: new Date().toISOString(),
  }).eq('workspace_id', workspaceId).eq('id', st.id).select().single()
  if (error) throw new Error(error.message)
  await recordAudit(db, {
    ...actorPayload({ ...actor, workspace_id: workspaceId }),
    object_type: 'staff', entity_id: st.id, operation: 'UPDATE',
    before_data: compactStaff(st),
    after_data: compactStaff(data),
    metadata: { action: 'terminate_staff' },
  })
  return {
    ok: true,
    action: 'terminated',
    employee_code: st.employee_code,
    display_name: st.display_name,
    terminated_on: data.terminated_on,
  }
}

export async function upsertCustomField(db, workspaceId, input, actor = {}) {
  const existingKey = String(input.key || '').trim().toLowerCase()
  const { data: existing } = existingKey
    ? await db.from('staff_profile_fields').select('*')
      .eq('workspace_id', workspaceId).eq('key', existingKey).maybeSingle()
    : { data: null }
  const parsed = validateCustomFieldDef(input, { updating: !!existing })
  const payload = {
    workspace_id: workspaceId,
    ...parsed,
    updated_at: new Date().toISOString(),
  }
  Object.keys(payload).forEach((k) => { if (payload[k] === undefined) delete payload[k] })

  let row
  if (existing) {
    const { data, error } = await db.from('staff_profile_fields')
      .update(payload).eq('id', existing.id).select().single()
    if (error) throw new Error(error.message)
    row = data
  } else {
    if (!parsed.label) throw new Error('label is required')
    const { data, error } = await db.from('staff_profile_fields').insert({
      ...payload,
      key: parsed.key,
      label: parsed.label,
      field_type: parsed.field_type || 'text',
      field_group: parsed.field_group || 'custom',
      sensitivity: parsed.sensitivity || 'directory',
      required: !!parsed.required,
      sort_order: parsed.sort_order ?? 100,
      is_active: parsed.is_active !== false,
    }).select().single()
    if (error) throw new Error(error.message)
    row = data
  }

  await recordAudit(db, {
    ...actorPayload({ ...actor, workspace_id: workspaceId }),
    object_type: 'staff_profile_fields', entity_id: row.id,
    operation: existing ? 'UPDATE' : 'INSERT',
    before_data: existing ? describeCustomField(existing, { includeSensitive: true }) : null,
    after_data: describeCustomField(row, { includeSensitive: true }),
  })
  return describeCustomField(row, { includeSensitive: true })
}

export async function deleteCustomField(db, workspaceId, ref, actor = {}) {
  const key = String(ref || '').trim()
  if (!key) throw new Error('field key or id is required')
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(key)
  let q = db.from('staff_profile_fields').select('*').eq('workspace_id', workspaceId)
  q = isUuid ? q.eq('id', key) : q.eq('key', key.toLowerCase())
  const { data: existing, error } = await q.maybeSingle()
  if (error) throw new Error(error.message)
  if (!existing) throw new Error(`No custom field "${key}". Built-in fields cannot be deleted.`)

  const { error: delErr } = await db.from('staff_profile_fields')
    .delete().eq('workspace_id', workspaceId).eq('id', existing.id)
  if (delErr) throw new Error(delErr.message)

  await recordAudit(db, {
    ...actorPayload({ ...actor, workspace_id: workspaceId }),
    object_type: 'staff_profile_fields', entity_id: existing.id, operation: 'DELETE',
    before_data: describeCustomField(existing, { includeSensitive: true }),
  })
  return { ok: true, deleted: existing.key, label: existing.label }
}


