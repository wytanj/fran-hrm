// Build the canonical people schema from the catalogs the app already runs.
// JSON and verbose prose are both derived here — there is no second hand-written
// policy document that can drift from the code.

import { createHash } from 'node:crypto'
import {
  ACCESS_METHOD_OPTIONS,
  BUILT_IN_FIELDS,
  EMPLOYMENT_STATUS_OPTIONS,
  EMPLOYMENT_TYPE_OPTIONS,
  FIELD_GROUPS,
  GENDER_OPTIONS,
  RACE_OPTIONS,
  RESIDENCY_OPTIONS,
  ROLE_OPTIONS,
  SENSITIVITIES,
} from '../staff/fields.mjs'
import { DEFAULT_ROLE_MATRIX, ROLE_LABELS, ROLES, SCOPES } from '../permissions/catalog.mjs'
import { INVARIANTS } from './invariants.mjs'

export const SCHEMA_ID = 'fran-hrm.people'
export const SCHEMA_FORMAT = 1

const PEOPLE_SCOPE_PREFIXES = ['staff:', 'org:']
const PEOPLE_SCOPES_EXTRA = ['reports:cost']

function compactField(f) {
  return {
    key: f.key,
    column: f.column || null,
    label: f.label,
    type: f.type,
    group: f.group,
    sensitivity: f.sensitivity,
    required: !!f.required,
    writable: f.writable !== false,
    create_only: !!f.createOnly,
    options: (f.options || []).map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label })),
    description: f.description || null,
  }
}

function peopleScopes() {
  return SCOPES
    .filter((s) => PEOPLE_SCOPE_PREFIXES.some((p) => s.scope.startsWith(p)) || PEOPLE_SCOPES_EXTRA.includes(s.scope))
    .map((s) => ({
      scope: s.scope,
      group: s.group,
      label: s.label,
      detail: s.detail,
    }))
}

function defaultPeopleMatrix() {
  const out = {}
  for (const role of ROLES) {
    const scopes = DEFAULT_ROLE_MATRIX[role] || []
    out[role] = scopes.filter((s) =>
      PEOPLE_SCOPE_PREFIXES.some((p) => s.startsWith(p)) || PEOPLE_SCOPES_EXTRA.includes(s))
  }
  return out
}

/** Core schema — identical for every workspace. This is what git versions. */
export function buildCoreSchema() {
  return {
    id: SCHEMA_ID,
    format: SCHEMA_FORMAT,
    jurisdiction: 'SG',
    currency: 'SGD',
    calendar: {
      timezone: 'Asia/Singapore',
      date_format: 'YYYY-MM-DD',
      week_starts: 'monday',
    },
    money: { unit: 'integer_cents', display_currency: 'SGD' },
    titles: {
      formal: 'positions.title',
      comms: 'staff.comms_title || positions.comms_title',
      display: 'comms || formal',
    },
    hierarchy: {
      seat_line: 'positions.reports_to_id',
      person_override: 'staff.reports_to_id',
      resolve_order: ['staff.reports_to_id', 'holder_of(seat.reports_to_id)'],
      vacant_or_shared: 'report_gap_do_not_guess',
    },
    accountability: {
      owner_required: true,
      owner_on: 'seat_first_person_pin',
      contributors_separate: true,
    },
    staff: {
      employment_types: EMPLOYMENT_TYPE_OPTIONS,
      employment_statuses: EMPLOYMENT_STATUS_OPTIONS,
      roles: ROLE_OPTIONS,
      access_methods: ACCESS_METHOD_OPTIONS,
      gender: GENDER_OPTIONS,
      citizenship: RESIDENCY_OPTIONS,
      race: RACE_OPTIONS,
      field_groups: FIELD_GROUPS.filter((g) => g.key !== 'custom'),
      sensitivities: SENSITIVITIES,
      fields: BUILT_IN_FIELDS.map(compactField),
      deletion: { real: 'terminate', dummy: 'purge' },
    },
    departments: {
      table: 'staff_departments',
      function_table: 'org_functions',
      many_to_many: true,
      primary_flag: 'is_primary',
      fallback: 'seat.function',
    },
    permissions: {
      people_scopes: peopleScopes(),
      default_matrix: defaultPeopleMatrix(),
      role_labels: ROLE_LABELS,
      sensitive_read: ['reports:cost', 'staff:write'],
    },
    invariants: INVARIANTS.map((i) => ({ id: i.id, topic: i.topic, statement: i.statement })),
  }
}

export async function loadWorkspaceOverlay(db, workspaceId) {
  const [{ data: fields }, { data: functions }, { data: leaveTypes }] = await Promise.all([
    db.from('staff_profile_fields')
      .select('key, label, description, field_type, field_group, sensitivity, options, required, is_active, sort_order')
      .eq('workspace_id', workspaceId)
      .order('sort_order'),
    db.from('org_functions')
      .select('key, name, description, sort_order')
      .eq('workspace_id', workspaceId)
      .order('sort_order'),
    db.from('leave_types')
      .select('code, name, is_paid, default_days_per_year, requires_attachment, is_active')
      .eq('workspace_id', workspaceId)
      .order('code'),
  ])
  return {
    custom_fields: (fields || []).map((f) => ({
      key: f.key,
      label: f.label,
      description: f.description || null,
      type: f.field_type,
      group: f.field_group,
      sensitivity: f.sensitivity,
      options: f.options || null,
      required: !!f.required,
      is_active: f.is_active !== false,
    })),
    departments: (functions || []).map((f) => ({
      key: f.key,
      name: f.name,
      description: f.description || null,
    })),
    leave_types: (leaveTypes || []).map((t) => ({
      code: t.code,
      name: t.name,
      is_paid: !!t.is_paid,
      default_days_per_year: Number(t.default_days_per_year) || 0,
      requires_attachment: !!t.requires_attachment,
      is_active: t.is_active !== false,
    })),
  }
}

export function assembleSchema(core, overlay = null) {
  return {
    ...core,
    workspace: overlay || { custom_fields: [], departments: [], leave_types: [] },
  }
}

/** Deterministic JSON for hashing — key order must not change the identity of a policy. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const keys = Object.keys(value).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

export function hashSchema(doc) {
  return createHash('sha256').update(stableStringify(doc)).digest('hex')
}

export function renderSchemaText(schema) {
  const lines = []
  const p = (s = '') => lines.push(s)
  p(`FranHRM people schema — in force`)
  p(`Identifier: ${schema.id}  ·  format ${schema.format}  ·  ${schema.jurisdiction}  ·  ${schema.currency}`)
  p('')
  p(`This is the human record. Dates are ${schema.calendar.date_format} on the ${schema.calendar.timezone} calendar; weeks start ${schema.calendar.week_starts}. Money is ${schema.money.unit}.`)
  p('')

  p(`TITLES`)
  p(`  Formal (payroll, contracts): ${schema.titles.formal}`)
  p(`  Comms (what we say): ${schema.titles.comms}`)
  p(`  Display: ${schema.titles.display}`)
  p('')

  p(`HIERARCHY`)
  p(`  Designed line: ${schema.hierarchy.seat_line}`)
  p(`  Person override: ${schema.hierarchy.person_override}`)
  p(`  Resolve order: ${schema.hierarchy.resolve_order.join(' → ')}`)
  p(`  Vacant or shared manager seat: ${schema.hierarchy.vacant_or_shared}`)
  p('')

  p(`ACCOUNTABILITY`)
  p(`  One owner, required. Owner attaches to a seat first, with an optional person pin. Contributors stay on their own table.`)
  p('')

  p(`CITIZENSHIP (staff.residency)`)
  for (const o of schema.staff.citizenship) p(`  - ${o.value}: ${o.label}`)
  p('')

  p(`RACE (Self-Help Group fund)`)
  for (const o of schema.staff.race) p(`  - ${o.value}: ${o.label}`)
  p('')

  p(`EMPLOYMENT`)
  p(`  Types: ${schema.staff.employment_types.map((o) => o.label).join(', ')}`)
  p(`  Status: ${schema.staff.employment_statuses.map((o) => o.label).join(', ')}`)
  p(`  Access roles: ${schema.staff.roles.map((o) => o.label).join(', ')}`)
  p(`  Offboarding: real staff are ${schema.staff.deletion.real}d; only dummies may be ${schema.staff.deletion.dummy}d.`)
  p('')

  p(`DEPARTMENTS`)
  p(`  ${schema.departments.many_to_many ? 'Many-to-many' : 'Single'} via ${schema.departments.table} → ${schema.departments.function_table}. Primary flag: ${schema.departments.primary_flag}. If empty, infer ${schema.departments.fallback}.`)
  if (schema.workspace?.departments?.length) {
    p(`  This workspace:`)
    for (const d of schema.workspace.departments) p(`    - ${d.key}: ${d.name}`)
  }
  p('')

  p(`STAFF FIELDS (built-in)`)
  let group = ''
  for (const f of schema.staff.fields) {
    if (f.group !== group) {
      group = f.group
      const label = (schema.staff.field_groups.find((g) => g.key === group) || {}).label || group
      p(`  [${label}]`)
    }
    const opts = f.options?.length ? ` ∈ {${f.options.map((o) => o.value).join(', ')}}` : ''
    const req = f.required ? ' required' : ''
    p(`    ${f.key} (${f.type}, ${f.sensitivity})${req}${opts}${f.description ? ` — ${f.description}` : ''}`)
  }
  p('')

  if (schema.workspace?.custom_fields?.length) {
    p(`CUSTOM FIELDS (this workspace)`)
    for (const f of schema.workspace.custom_fields) {
      p(`    ${f.key} (${f.type}, ${f.sensitivity}${f.is_active ? '' : ', inactive'}) — ${f.label}`)
    }
    p('')
  }

  if (schema.workspace?.leave_types?.length) {
    p(`LEAVE TYPES (this workspace)`)
    for (const t of schema.workspace.leave_types) {
      p(`    ${t.code} ${t.name} — ${t.default_days_per_year} days/year, ${t.is_paid ? 'paid' : 'unpaid'}${t.is_active ? '' : ', inactive'}`)
    }
    p('')
  }

  p(`PEOPLE PERMISSIONS`)
  p(`  Sensitive pay/PII readable with: ${schema.permissions.sensitive_read.join(' or ')}`)
  for (const s of schema.permissions.people_scopes) {
    p(`    ${s.scope} — ${s.label}`)
  }
  p('')

  p(`INVARIANTS`)
  for (const i of schema.invariants) {
    p(`  [${i.id}] ${i.statement}`)
  }
  p('')
  p(`End of people schema.`)
  return lines.join('\n')
}

export function prettySchemaJson(schema) {
  return `${JSON.stringify(schema, null, 2)}\n`
}
