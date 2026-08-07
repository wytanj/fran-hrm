// Mapped rows → validated shifts, with a per-row verdict.
//
// This is the dry run. Nothing here writes: it resolves people, dates, times
// and templates against the real workspace and reports what each row would do.
// A row that cannot be resolved fails alone — the rest of the sheet still
// imports, because a single unknown name should not block a whole week.

import { normaliseTime } from '../roster/constraints.mjs'

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 }
const OFF_VALUES = new Set(['', 'off', 'x', '-', '—', 'rest', 'rd', 'off day', 'nil', 'na', 'n/a', 'leave', 'al', 'mc', 'ph'])

/**
 * Parse the many date shapes a sheet carries. `contextYear` fills in the year
 * for headers like "Mon 17/08" that omit it.
 */
export function parseSheetDate(value, { contextYear, dayFirst = true } = {}) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const year = contextYear || new Date().getUTCFullYear()

  // ISO first — unambiguous.
  const iso = raw.match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (iso) return `${iso[1]}-${pad(iso[2])}-${pad(iso[3])}`

  // "17 Aug", "Aug 17", "Sat 22 Aug 2026"
  const named = raw.toLowerCase().match(/(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{4})?/)
    || raw.toLowerCase().match(/(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*(\d{1,2})\s*,?\s*(\d{4})?/)
  if (named) {
    const isDayFirst = /^\d/.test(named[0].trim())
    const d = isDayFirst ? named[1] : named[2]
    const mon = isDayFirst ? named[2] : named[1]
    const y = named[3] || year
    return `${y}-${pad(MONTHS[mon])}-${pad(d)}`
  }

  // Numeric: 17/08/2026, 17-08, 08/17/2026
  const nums = raw.match(/(\d{1,2})[/\-.](\d{1,2})(?:[/\-.](\d{2,4}))?/)
  if (nums) {
    let a = Number(nums[1])
    let b = Number(nums[2])
    let y = nums[3] ? Number(nums[3]) : year
    if (y < 100) y += 2000
    let day = dayFirst ? a : b
    let month = dayFirst ? b : a
    // If the "month" is impossible, the sheet was month-first after all.
    if (month > 12 && day <= 12) { const t = day; day = month; month = t }
    if (month < 1 || month > 12 || day < 1 || day > 31) return null
    return `${y}-${pad(month)}-${pad(day)}`
  }
  return null
}

const pad = (n) => String(n).padStart(2, '0')

/** "9:30-18:30", "0930 - 1830", "9.30am to 6.30pm" → { start, end } */
export function parseTimeRange(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return null
  const parts = raw.split(/\s*(?:-|–|—|to|until|till)\s*/i).filter(Boolean)
  if (parts.length < 2) return null
  const start = normaliseTime(parts[0])
  const end = normaliseTime(parts[1])
  if (!start || !end) return null
  return { start, end }
}

export function isOffValue(value, aliases = {}) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (Object.prototype.hasOwnProperty.call(aliases, raw) && aliases[raw] === null) return true
  return OFF_VALUES.has(raw)
}

/**
 * Normalise mapped rows into candidate shifts.
 *
 * @param {object} input
 * @param {Array<object>} input.rows parsed sheet rows
 * @param {Record<string,string|null>} input.mapping field → header
 * @param {'rows'|'grid'} input.layout
 * @param {string[]} [input.dateColumns] grid layout: the date headers
 * @param {Array} input.staff  workspace staff for resolution
 * @param {Array} input.templates shift templates for label resolution
 * @param {Array} input.stores
 * @param {object} [input.valueAliases] sheet-specific value translations
 * @param {string} [input.defaultStoreId]
 * @param {number} [input.contextYear]
 * @returns {{ shifts: Array, errors: Array, stats: object }}
 */
export function normaliseRosterRows({
  rows, mapping, layout = 'rows', dateColumns = [], staff = [], templates = [],
  stores = [], valueAliases = {}, defaultStoreId = null, contextYear,
}) {
  const byCode = new Map(staff.map((s) => [String(s.employee_code).toUpperCase(), s]))
  const byName = new Map()
  for (const s of staff) {
    const k = String(s.display_name).toLowerCase().replace(/\s+/g, ' ').trim()
    byName.set(k, byName.has(k) ? null : s) // null marks an ambiguous name
  }
  const templateByName = new Map()
  for (const t of templates) {
    templateByName.set(String(t.name).toLowerCase(), t)
    // Common shorthand people type in sheets.
    if (/open/i.test(t.name)) templateByName.set('am', t)
    if (/clos/i.test(t.name)) templateByName.set('pm', t)
  }
  const storeByCode = new Map(stores.map((s) => [String(s.code).toUpperCase(), s]))

  const shifts = []
  const errors = []
  let offCells = 0

  const resolvePerson = (row, rowNo) => {
    const code = mapping.employee_code ? String(row[mapping.employee_code] ?? '').trim().toUpperCase() : ''
    if (code) {
      const found = byCode.get(code)
      if (found) return found
      // Some sheets put the name in the code column.
      const asName = byName.get(code.toLowerCase())
      if (asName) return asName
      errors.push({ row: rowNo, field: 'employee_code', value: code, error: `No staff member with code "${code}"` })
      return null
    }
    const name = mapping.staff_name ? String(row[mapping.staff_name] ?? '').trim() : ''
    if (!name) { errors.push({ row: rowNo, field: 'staff', value: '', error: 'No employee code or name in this row' }); return null }
    const key = name.toLowerCase().replace(/\s+/g, ' ')
    if (byName.has(key)) {
      const hit = byName.get(key)
      if (hit) return hit
      errors.push({ row: rowNo, field: 'staff_name', value: name, error: `"${name}" matches more than one staff member — use employee codes in this sheet` })
      return null
    }
    // Loose match: surname or first name alone.
    const loose = staff.filter((s) => s.display_name.toLowerCase().includes(key) || key.includes(s.display_name.toLowerCase().split(' ')[0]))
    if (loose.length === 1) return loose[0]
    errors.push({
      row: rowNo, field: 'staff_name', value: name,
      error: loose.length > 1 ? `"${name}" is ambiguous (${loose.map((s) => s.employee_code).join(', ')})` : `No staff member matching "${name}"`,
    })
    return null
  }

  const resolveTimes = (cellValue, row, rowNo) => {
    // 1. A template/shift label.
    const label = cellValue ?? (mapping.shift_label ? row[mapping.shift_label] : '')
    const aliased = applyAlias(label, valueAliases)
    if (aliased) {
      const tpl = templateByName.get(String(aliased).toLowerCase().trim())
      if (tpl) {
        return { start: String(tpl.start_time).slice(0, 5), end: String(tpl.end_time).slice(0, 5), break_minutes: tpl.break_minutes, template_id: tpl.id, template: tpl.name }
      }
      const range = parseTimeRange(aliased)
      if (range) return { ...range, break_minutes: null }
    }
    // 2. Explicit start/end columns.
    if (mapping.start_time && mapping.end_time) {
      const start = normaliseTime(row[mapping.start_time])
      const end = normaliseTime(row[mapping.end_time])
      if (start && end) return { start, end, break_minutes: null }
    }
    errors.push({
      row: rowNo, field: 'time', value: String(label ?? ''),
      error: label
        ? `Could not read "${label}" as a shift. Add it as a shift template, or use a time range like "09:30-18:30".`
        : 'No shift time or template in this row',
    })
    return null
  }

  const resolveStore = (row, rowNo) => {
    if (!mapping.store_code) return defaultStoreId
    const code = String(row[mapping.store_code] ?? '').trim().toUpperCase()
    if (!code) return defaultStoreId
    const store = storeByCode.get(code) || stores.find((s) => s.name.toLowerCase() === code.toLowerCase())
    if (store) return store.id
    errors.push({ row: rowNo, field: 'store_code', value: code, error: `No store with code "${code}"` })
    return null
  }

  for (const row of rows) {
    const rowNo = row.__row ?? 0
    const person = resolvePerson(row, rowNo)
    if (!person) continue
    const storeId = resolveStore(row, rowNo)
    if (!storeId) continue

    if (layout === 'grid') {
      // One shift per date column that isn't an "off" marker.
      for (const dateCol of dateColumns) {
        const cell = row[dateCol]
        if (isOffValue(cell, valueAliases)) { offCells += 1; continue }
        const date = parseSheetDate(dateCol, { contextYear })
        if (!date) {
          errors.push({ row: rowNo, field: 'work_date', value: dateCol, error: `Could not read a date from the column header "${dateCol}"` })
          continue
        }
        const times = resolveTimes(cell, row, rowNo)
        if (!times) continue
        shifts.push(buildShift({ person, storeId, date, times, row, mapping, source_cell: dateCol }))
      }
      continue
    }

    // rows layout
    const date = parseSheetDate(row[mapping.work_date], { contextYear })
    if (!date) {
      errors.push({ row: rowNo, field: 'work_date', value: String(row[mapping.work_date] ?? ''), error: 'Could not read a date' })
      continue
    }
    const cell = mapping.shift_label ? row[mapping.shift_label] : null
    if (isOffValue(cell, valueAliases) && !(mapping.start_time && row[mapping.start_time])) { offCells += 1; continue }
    const times = resolveTimes(cell, row, rowNo)
    if (!times) continue
    shifts.push(buildShift({ person, storeId, date, times, row, mapping }))
  }

  // Duplicate detection: same person, same day, same start.
  const seen = new Map()
  const deduped = []
  for (const sh of shifts) {
    const key = `${sh.staff_id}|${sh.work_date}|${sh.start}`
    if (seen.has(key)) {
      errors.push({ row: sh.__row, field: 'duplicate', value: `${sh.employee_code} ${sh.work_date} ${sh.start}`, error: 'Duplicate of an earlier row — skipped' })
      continue
    }
    seen.set(key, true)
    deduped.push(sh)
  }

  const dates = deduped.map((s) => s.work_date).sort()
  return {
    shifts: deduped,
    errors,
    stats: {
      rows_read: rows.length,
      shifts_found: deduped.length,
      off_cells: offCells,
      failed_rows: new Set(errors.map((e) => e.row)).size,
      date_range: dates.length ? { from: dates[0], to: dates[dates.length - 1] } : null,
      staff_count: new Set(deduped.map((s) => s.staff_id)).size,
    },
  }
}

function applyAlias(value, aliases) {
  const raw = String(value ?? '').trim()
  const key = raw.toLowerCase()
  if (Object.prototype.hasOwnProperty.call(aliases, key)) return aliases[key]
  if (Object.prototype.hasOwnProperty.call(aliases, raw)) return aliases[raw]
  return raw
}

function buildShift({ person, storeId, date, times, row, mapping, source_cell }) {
  const breakFromSheet = mapping.break_minutes ? Number(row[mapping.break_minutes]) : NaN
  return {
    __row: row.__row,
    staff_id: person.id,
    employee_code: person.employee_code,
    display_name: person.display_name,
    store_id: storeId,
    work_date: date,
    start: times.start,
    end: times.end,
    start_at: `${date}T${times.start}:00+08:00`,
    end_at: `${date}T${times.end}:00+08:00`,
    break_minutes: Number.isFinite(breakFromSheet) ? breakFromSheet : (times.break_minutes ?? 0),
    template_id: times.template_id || null,
    template: times.template || null,
    job_code: mapping.job_code ? (String(row[mapping.job_code] ?? '').trim() || null) : null,
    notes: mapping.notes ? (String(row[mapping.notes] ?? '').trim() || null) : null,
    source_cell: source_cell || null,
  }
}
