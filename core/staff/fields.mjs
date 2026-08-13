// Staff profile field catalog — the source of truth for what a staff record
// can hold. Built-in fields map to columns on `staff`. Workspace-defined
// fields (staff_profile_fields) are merged on top at read time.
//
// Adding a first-class column: migration + one entry here. Adding a
// workspace-specific field: a catalog row, no deploy.
//
// Sensitivity:
//   directory     — staff:read (names, titles, role, store)
//   pii           — reports:cost or staff:write (NRIC, address, race, citizenship)
//   compensation  — reports:cost or staff:write (salary, bank)

export const FIELD_GROUPS = [
  { key: 'identity', label: 'Identity' },
  { key: 'employment', label: 'Employment' },
  { key: 'org', label: 'Org & hierarchy' },
  { key: 'contact', label: 'Contact' },
  { key: 'address', label: 'Home address' },
  { key: 'statutory', label: 'Statutory (Singapore)' },
  { key: 'compensation', label: 'Pay' },
  { key: 'custom', label: 'Custom' },
]

export const FIELD_TYPES = ['text', 'number', 'date', 'boolean', 'enum', 'money_cents', 'store_ref', 'position_ref', 'staff_ref']

export const SENSITIVITIES = ['directory', 'pii', 'compensation']

export const RESIDENCY_OPTIONS = [
  { value: 'citizen', label: 'Singaporean' },
  { value: 'pr', label: 'PR' },
  { value: 'foreigner', label: 'Foreigner' },
]

export const RACE_OPTIONS = [
  { value: 'chinese', label: 'Chinese' },
  { value: 'malay', label: 'Malay' },
  { value: 'indian', label: 'Indian' },
  { value: 'eurasian', label: 'Eurasian' },
  { value: 'other', label: 'Other' },
]

export const GENDER_OPTIONS = [
  { value: 'female', label: 'Female' },
  { value: 'male', label: 'Male' },
  { value: 'non_binary', label: 'Non-binary' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
  { value: 'other', label: 'Other' },
]

export const ROLE_OPTIONS = [
  { value: 'staff', label: 'Staff' },
  { value: 'supervisor', label: 'Supervisor' },
  { value: 'store_manager', label: 'Store Manager' },
  { value: 'area_manager', label: 'Area Manager' },
  { value: 'finance', label: 'Finance' },
  { value: 'hq_admin', label: 'HQ Admin' },
]

export const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contractor', label: 'Contractor' },
]

export const EMPLOYMENT_STATUS_OPTIONS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'terminated', label: 'Terminated' },
]

export const ACCESS_METHOD_OPTIONS = [
  { value: 'pin', label: 'PIN' },
  { value: 'sso', label: 'Google SSO' },
  { value: 'otp', label: 'OTP' },
]

/** @type {Array<{
 *   key: string,
 *   column?: string,
 *   label: string,
 *   type: string,
 *   group: string,
 *   sensitivity: 'directory' | 'pii' | 'compensation',
 *   writable?: boolean,
 *   createOnly?: boolean,
 *   required?: boolean,
 *   options?: Array<{value: string, label: string}>,
 *   description?: string,
 *   sort_order: number,
 * }>} */
export const BUILT_IN_FIELDS = [
  { key: 'display_name', column: 'display_name', label: 'Name', type: 'text', group: 'identity', sensitivity: 'directory', required: true, sort_order: 10 },
  { key: 'employee_code', column: 'employee_code', label: 'Employee code', type: 'text', group: 'identity', sensitivity: 'directory', writable: false, createOnly: true, sort_order: 20 },
  { key: 'gender', column: 'gender', label: 'Gender', type: 'enum', group: 'identity', sensitivity: 'directory', options: GENDER_OPTIONS, sort_order: 30 },
  { key: 'date_of_birth', column: 'date_of_birth', label: 'Date of birth', type: 'date', group: 'identity', sensitivity: 'pii', sort_order: 40 },
  { key: 'nric', column: 'nric', label: 'NRIC / FIN', type: 'text', group: 'statutory', sensitivity: 'pii', description: 'Singapore NRIC or FIN. Sensitive.', sort_order: 10 },
  { key: 'race', column: 'race', label: 'Race', type: 'enum', group: 'statutory', sensitivity: 'pii', options: RACE_OPTIONS, description: 'Drives the Self-Help Group fund on the CPF EZPay file.', sort_order: 20 },
  { key: 'residency', column: 'residency', label: 'Citizenship', type: 'enum', group: 'statutory', sensitivity: 'pii', options: RESIDENCY_OPTIONS, description: 'Singaporean, PR or foreigner.', sort_order: 30 },
  { key: 'nationality', column: 'nationality', label: 'Nationality', type: 'text', group: 'statutory', sensitivity: 'pii', sort_order: 40 },
  { key: 'pr_start_date', column: 'pr_start_date', label: 'PR start date', type: 'date', group: 'statutory', sensitivity: 'pii', description: 'Required for PR so CPF can pick year 1 / year 2 / year 3.', sort_order: 50 },
  { key: 'cpf_applicable', column: 'cpf_applicable', label: 'CPF applicable', type: 'boolean', group: 'statutory', sensitivity: 'pii', sort_order: 60 },

  { key: 'role', column: 'role', label: 'Access role', type: 'enum', group: 'employment', sensitivity: 'directory', options: ROLE_OPTIONS, sort_order: 10 },
  { key: 'employment_type', column: 'employment_type', label: 'Employment type', type: 'enum', group: 'employment', sensitivity: 'directory', options: EMPLOYMENT_TYPE_OPTIONS, sort_order: 20 },
  { key: 'employment_status', column: 'employment_status', label: 'Status', type: 'enum', group: 'employment', sensitivity: 'directory', options: EMPLOYMENT_STATUS_OPTIONS, sort_order: 30 },
  { key: 'hired_on', column: 'hired_on', label: 'Hired on', type: 'date', group: 'employment', sensitivity: 'directory', sort_order: 40 },
  { key: 'terminated_on', column: 'terminated_on', label: 'Terminated on', type: 'date', group: 'employment', sensitivity: 'directory', sort_order: 50 },
  { key: 'home_store_id', column: 'home_store_id', label: 'Home store', type: 'store_ref', group: 'employment', sensitivity: 'directory', sort_order: 60 },
  { key: 'access_method', column: 'access_method', label: 'Sign-in method', type: 'enum', group: 'employment', sensitivity: 'directory', options: ACCESS_METHOD_OPTIONS, sort_order: 70 },
  { key: 'pos_access_enabled', column: 'pos_access_enabled', label: 'POS access', type: 'boolean', group: 'employment', sensitivity: 'directory', sort_order: 80 },
  { key: 'pt_weekly_hour_cap', column: 'pt_weekly_hour_cap', label: 'PT weekly hour cap', type: 'number', group: 'employment', sensitivity: 'directory', sort_order: 90 },
  { key: 'pt_monthly_hour_cap', column: 'pt_monthly_hour_cap', label: 'PT monthly hour cap', type: 'number', group: 'employment', sensitivity: 'directory', sort_order: 100 },

  { key: 'position_id', column: 'position_id', label: 'Seat', type: 'position_ref', group: 'org', sensitivity: 'directory', description: 'The designed org seat. Titles come from here.', sort_order: 10 },
  { key: 'comms_title', column: 'comms_title', label: 'Comms title override', type: 'text', group: 'org', sensitivity: 'directory', description: 'Per-person outward title. Blank = use the seat\'s comms title.', sort_order: 20 },
  { key: 'reports_to_id', column: 'reports_to_id', label: 'Reports to (override)', type: 'staff_ref', group: 'org', sensitivity: 'directory', description: 'Explicit manager. Blank = derive from the seat.', sort_order: 30 },

  { key: 'email', column: 'email', label: 'Email', type: 'text', group: 'contact', sensitivity: 'directory', sort_order: 10 },
  { key: 'phone', column: 'phone', label: 'Phone', type: 'text', group: 'contact', sensitivity: 'directory', sort_order: 20 },
  { key: 'emergency_contact_name', column: 'emergency_contact_name', label: 'Emergency contact', type: 'text', group: 'contact', sensitivity: 'pii', sort_order: 30 },
  { key: 'emergency_contact_phone', column: 'emergency_contact_phone', label: 'Emergency phone', type: 'text', group: 'contact', sensitivity: 'pii', sort_order: 40 },

  { key: 'address_line_1', column: 'address_line_1', label: 'Address line 1', type: 'text', group: 'address', sensitivity: 'pii', sort_order: 10 },
  { key: 'address_line_2', column: 'address_line_2', label: 'Address line 2', type: 'text', group: 'address', sensitivity: 'pii', sort_order: 20 },
  { key: 'unit_number', column: 'unit_number', label: 'Unit number', type: 'text', group: 'address', sensitivity: 'pii', sort_order: 30 },
  { key: 'postal_code', column: 'postal_code', label: 'Postal code', type: 'text', group: 'address', sensitivity: 'pii', sort_order: 40 },
  { key: 'country', column: 'country', label: 'Country', type: 'text', group: 'address', sensitivity: 'pii', sort_order: 50 },

  { key: 'monthly_salary_cents', column: 'monthly_salary_cents', label: 'Monthly salary', type: 'money_cents', group: 'compensation', sensitivity: 'compensation', description: 'Monthly basic, integer cents. For salaried / full-time.', sort_order: 10 },
  { key: 'hourly_rate_cents', column: 'hourly_rate_cents', label: 'Hourly rate', type: 'money_cents', group: 'compensation', sensitivity: 'compensation', description: 'Hourly rate, integer cents. For part-time.', sort_order: 20 },
  { key: 'bank_name', column: 'bank_name', label: 'Bank', type: 'text', group: 'compensation', sensitivity: 'compensation', sort_order: 30 },
  { key: 'bank_account_no', column: 'bank_account_no', label: 'Bank account', type: 'text', group: 'compensation', sensitivity: 'compensation', sort_order: 40 },
]

export const BUILT_IN_BY_KEY = Object.fromEntries(BUILT_IN_FIELDS.map((f) => [f.key, f]))

export const BUILT_IN_COLUMNS = BUILT_IN_FIELDS.map((f) => f.column).filter(Boolean)

const RESERVED_KEYS = new Set([
  ...BUILT_IN_FIELDS.map((f) => f.key),
  'id', 'workspace_id', 'pin', 'pin_hash', 'failed_attempts', 'locked_until',
  'metadata', 'auth_user_id', 'is_dummy', 'created_at', 'updated_at',
  'departments', 'custom', 'fields', 'hierarchy', 'seat', 'staff',
])

export function isReservedFieldKey(key) {
  return RESERVED_KEYS.has(String(key || ''))
}

export function canSeeSensitivity(sensitivity, { includeSensitive = false } = {}) {
  if (sensitivity === 'directory') return true
  return !!includeSensitive
}

export function optionValues(field) {
  return (field?.options || []).map((o) => (typeof o === 'string' ? o : o.value))
}

export function optionLabel(field, value) {
  if (value == null || value === '') return null
  const hit = (field?.options || []).find((o) => (typeof o === 'string' ? o : o.value) === value)
  if (!hit) return String(value)
  return typeof hit === 'string' ? hit : hit.label
}

function isBlank(v) {
  return v === undefined || v === null || v === ''
}

export function coerceFieldValue(field, raw) {
  if (isBlank(raw)) return null
  const type = field?.type || field?.field_type || 'text'
  if (type === 'boolean') {
    if (typeof raw === 'boolean') return raw
    const s = String(raw).trim().toLowerCase()
    if (['true', '1', 'yes', 'y'].includes(s)) return true
    if (['false', '0', 'no', 'n'].includes(s)) return false
    throw new Error(`${field.key} must be true or false`)
  }
  if (type === 'number' || type === 'money_cents') {
    const n = typeof raw === 'number' ? raw : Number(String(raw).trim())
    if (!Number.isFinite(n)) throw new Error(`${field.key} must be a number`)
    if (type === 'money_cents') {
      const cents = Math.round(n)
      if (cents < 0) throw new Error(`${field.key} cannot be negative`)
      return cents
    }
    return n
  }
  if (type === 'date') {
    const s = String(raw).trim().slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error(`${field.key} must be YYYY-MM-DD`)
    return s
  }
  if (type === 'enum') {
    const allowed = optionValues(field)
    const v = String(raw).trim()
    const lower = v.toLowerCase()
    const hit = allowed.find((a) => a === v || a === lower)
    if (allowed.length && !hit) {
      throw new Error(`${field.key} must be one of: ${allowed.join(', ')}`)
    }
    return hit || v
  }
  if (type === 'store_ref' || type === 'position_ref' || type === 'staff_ref') {
    return String(raw).trim()
  }
  const s = String(raw).trim()
  return s || null
}

export function serializeCustomValue(field, value) {
  const coerced = coerceFieldValue(field, value)
  if (coerced === null) return null
  if (typeof coerced === 'boolean') return coerced ? 'true' : 'false'
  return String(coerced)
}

export function parseCustomValue(field, valueText) {
  if (valueText == null || valueText === '') return null
  return coerceFieldValue(field, valueText)
}

export function validateCustomFieldDef(input, { updating = false } = {}) {
  const key = String(input.key || '').trim().toLowerCase()
  if (!updating || input.key !== undefined) {
    if (!/^[a-z][a-z0-9_]{1,62}$/.test(key)) {
      throw new Error('Field key must be a slug: start with a letter, then letters, digits or underscore (max 63).')
    }
    if (isReservedFieldKey(key)) {
      throw new Error(`"${key}" is a built-in staff field — pick a different key rather than shadowing it.`)
    }
  }
  const label = String(input.label || '').trim()
  if (!updating && !label) throw new Error('label is required')
  const field_type = input.field_type || input.type || 'text'
  if (!['text', 'number', 'date', 'boolean', 'enum', 'money_cents'].includes(field_type)) {
    throw new Error(`field_type must be one of text, number, date, boolean, enum, money_cents (got ${field_type})`)
  }
  const sensitivity = input.sensitivity || 'directory'
  if (!SENSITIVITIES.includes(sensitivity)) {
    throw new Error(`sensitivity must be directory, pii or compensation (got ${sensitivity})`)
  }
  const field_group = String(input.field_group || input.group || 'custom').trim() || 'custom'
  let options = input.options ?? null
  if (options) {
    if (!Array.isArray(options)) throw new Error('options must be an array of {value, label} or strings')
    options = options.map((o) => {
      if (typeof o === 'string') return { value: o, label: o }
      const value = String(o.value || '').trim()
      if (!value) throw new Error('each option needs a value')
      return { value, label: String(o.label || value).trim() }
    })
  }
  if (field_type === 'enum' && !updating && !(options && options.length)) {
    throw new Error('enum fields need an options list')
  }
  return {
    key: updating && input.key === undefined ? undefined : key,
    label: label || undefined,
    description: input.description === undefined ? undefined : (input.description ? String(input.description) : null),
    field_type,
    field_group,
    sensitivity,
    options,
    required: input.required === undefined ? undefined : !!input.required,
    sort_order: input.sort_order === undefined ? undefined : (Number(input.sort_order) || 100),
    is_active: input.is_active === undefined ? undefined : !!input.is_active,
  }
}

export function describeBuiltInField(field, { includeSensitive = false } = {}) {
  const visible = canSeeSensitivity(field.sensitivity, { includeSensitive })
  return {
    key: field.key,
    source: 'built_in',
    label: field.label,
    description: field.description || null,
    type: field.type,
    group: field.group,
    sensitivity: field.sensitivity,
    required: !!field.required,
    writable: field.writable !== false,
    create_only: !!field.createOnly,
    options: field.options || null,
    sort_order: field.sort_order,
    visible,
  }
}

export function describeCustomField(row, { includeSensitive = false } = {}) {
  const field = customRowAsField(row)
  return {
    key: row.key,
    id: row.id,
    source: 'custom',
    label: row.label,
    description: row.description || null,
    type: row.field_type,
    group: row.field_group || 'custom',
    sensitivity: row.sensitivity,
    required: !!row.required,
    writable: true,
    create_only: false,
    options: row.options || null,
    sort_order: row.sort_order ?? 100,
    is_active: row.is_active !== false,
    visible: canSeeSensitivity(field.sensitivity, { includeSensitive }),
  }
}

export function customRowAsField(row) {
  return {
    key: row.key,
    label: row.label,
    type: row.field_type,
    group: row.field_group,
    sensitivity: row.sensitivity,
    options: row.options || [],
    required: !!row.required,
  }
}

/** Pull catalog-known keys out of a flat input object (REST body / MCP args). */
export function pickCatalogInput(input = {}) {
  const builtIn = {}
  for (const f of BUILT_IN_FIELDS) {
    if (input[f.key] !== undefined) builtIn[f.key] = input[f.key]
  }
  // Nested `fields` bag wins for the same key so an agent can send either shape.
  if (input.fields && typeof input.fields === 'object') {
    for (const [k, v] of Object.entries(input.fields)) {
      if (BUILT_IN_BY_KEY[k]) builtIn[k] = v
    }
  }
  const custom = (input.custom && typeof input.custom === 'object') ? { ...input.custom } : {}
  if (input.fields && typeof input.fields === 'object') {
    for (const [k, v] of Object.entries(input.fields)) {
      if (!BUILT_IN_BY_KEY[k]) custom[k] = v
    }
  }
  return {
    builtIn,
    custom,
    departments: input.departments,
    pin: input.pin,
    is_dummy: input.is_dummy,
    employee_code: input.employee_code,
    display_name: input.display_name,
  }
}

export function residencyLabel(value) {
  return optionLabel({ options: RESIDENCY_OPTIONS }, value)
}

export function raceLabel(value) {
  return optionLabel({ options: RACE_OPTIONS }, value)
}
