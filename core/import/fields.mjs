// Importable roster fields + the aliases that let us guess a store's columns.
//
// Same shape as fran-skums' FIXED_IMPORT_FIELDS: key, label, group, type,
// required. The alias lists are the whole trick — every store names its columns
// differently ("Staff", "Name", "Employee", "BA"), and guessing right means the
// person confirming a mapping clicks Continue instead of doing 8 dropdowns.

export const ROSTER_IMPORT_FIELDS = [
  { key: 'employee_code', label: 'Employee Code', group: 'Who', type: 'string', required: false, help: 'Preferred — unambiguous. If absent we match on name.' },
  { key: 'staff_name', label: 'Staff Name', group: 'Who', type: 'string', required: false, help: 'Used when there is no employee code. Must match a staff member.' },
  { key: 'work_date', label: 'Date', group: 'When', type: 'date', required: true },
  { key: 'start_time', label: 'Start Time', group: 'When', type: 'time', required: false, help: 'Not needed if a Shift/Template column names a shift.' },
  { key: 'end_time', label: 'End Time', group: 'When', type: 'time', required: false },
  { key: 'shift_label', label: 'Shift / Template', group: 'When', type: 'string', required: false, help: 'e.g. "Opening", "AM", "Closing" — resolved against your shift templates.' },
  { key: 'break_minutes', label: 'Break (min)', group: 'When', type: 'integer', required: false },
  { key: 'job_code', label: 'Job Code', group: 'Detail', type: 'string', required: false },
  { key: 'store_code', label: 'Store', group: 'Detail', type: 'string', required: false, help: 'Only needed when one sheet covers several stores.' },
  { key: 'notes', label: 'Notes', group: 'Detail', type: 'string', required: false },
]

export const FIELD_KEYS = ROSTER_IMPORT_FIELDS.map((f) => f.key)

/**
 * Header aliases, lower-cased and punctuation-stripped at match time.
 * Order matters within a list only for readability; matching is exact-then-fuzzy.
 */
export const FIELD_ALIASES = {
  employee_code: [
    'employee code', 'employee id', 'employee no', 'emp code', 'emp id', 'emp no',
    'staff code', 'staff id', 'staff no', 'code', 'id', 'payroll no', 'payroll id',
    'badge', 'badge no', 'personnel no',
  ],
  staff_name: [
    'staff', 'staff name', 'name', 'employee', 'employee name', 'full name',
    'person', 'team member', 'crew', 'ba', 'advisor', 'consultant', 'who',
  ],
  work_date: [
    'date', 'work date', 'shift date', 'day', 'roster date', 'duty date',
    'calendar date', 'dt', 'date worked',
  ],
  start_time: [
    'start', 'start time', 'from', 'time in', 'in', 'clock in', 'shift start',
    'begin', 'time from', 'start hr', 'starting time',
  ],
  end_time: [
    'end', 'end time', 'to', 'time out', 'out', 'clock out', 'shift end',
    'finish', 'time to', 'end hr', 'ending time',
  ],
  shift_label: [
    'shift', 'shift type', 'shift name', 'template', 'shift template', 'schedule',
    'roster', 'duty', 'slot', 'session', 'shift code', 'am pm', 'shift pattern',
  ],
  break_minutes: [
    'break', 'break min', 'break minutes', 'break mins', 'meal break',
    'unpaid break', 'lunch', 'lunch break', 'break duration',
  ],
  job_code: [
    'job code', 'job', 'role', 'position', 'task', 'station', 'area', 'department',
    'assignment', 'duty type', 'counter',
  ],
  store_code: [
    'store', 'store code', 'location', 'branch', 'outlet', 'site', 'shop', 'store name',
  ],
  notes: ['note', 'notes', 'remark', 'remarks', 'comment', 'comments'],
}

/** Strip punctuation/spacing so "Emp. Code" matches "emp code". */
export function normaliseHeader(header) {
  return String(header || '')
    .toLowerCase()
    .replace(/[_\-./\\]+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Does this header look like a date? Used to detect the grid layout. */
export function headerLooksLikeDate(header) {
  const h = String(header || '').trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(h)) return true
  if (/^\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?$/.test(h)) return true
  // "Mon 17/08", "Sat 22 Aug", "Tue 18"
  if (/^(mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[a-z]*\.?\s*\d{1,2}/i.test(h)) return true
  if (/^\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/i.test(h)) return true
  return false
}

export function fieldMeta(key) {
  return ROSTER_IMPORT_FIELDS.find((f) => f.key === key) || null
}
