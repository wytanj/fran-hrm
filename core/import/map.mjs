// Column → field mapping: guess it, describe the guess, apply it.
//
// The guess is scored rather than first-match so a sheet with both "Staff" and
// "Staff Code" puts each in the right place. Every suggestion carries a
// confidence and the reason it was chosen, because the confirmation screen is
// only quick if the user can see why we guessed and correct one dropdown.

import { FIELD_ALIASES, FIELD_KEYS, ROSTER_IMPORT_FIELDS, headerLooksLikeDate, normaliseHeader } from './fields.mjs'

function scoreHeaderAgainstField(header, fieldKey) {
  const h = normaliseHeader(header)
  if (!h) return { score: 0, why: '' }
  const aliases = FIELD_ALIASES[fieldKey] || []

  for (const alias of aliases) {
    const a = normaliseHeader(alias)
    if (h === a) return { score: 100, why: `exact match on "${alias}"` }
  }
  // Whole-word containment, longest alias wins so "staff code" beats "staff".
  let best = { score: 0, why: '' }
  for (const alias of aliases) {
    const a = normaliseHeader(alias)
    if (!a) continue
    if (h.includes(a) || a.includes(h)) {
      const overlap = Math.min(h.length, a.length) / Math.max(h.length, a.length)
      const score = Math.round(55 + overlap * 35)
      if (score > best.score) best = { score, why: `looks like "${alias}"` }
    }
  }
  if (normaliseHeader(fieldKey) === h) return { score: 100, why: 'matches the field name' }
  return best
}

/**
 * Detect the sheet layout.
 *
 * 'grid'  — staff rows × date columns (what most stores keep in Sheets)
 * 'rows'  — one row per shift
 */
export function detectLayout(headers) {
  const dateish = headers.filter(headerLooksLikeDate)
  // date_columns is reported either way. A caller that forces layout='grid'
  // (a saved mapping, or a user override on a short 2-day sheet) still needs
  // the list — withholding it below the auto-detect threshold silently yields
  // zero shifts.
  if (dateish.length >= 3) {
    return {
      layout: 'grid',
      date_columns: dateish,
      confidence: Math.min(0.99, 0.6 + dateish.length * 0.05),
      why: `${dateish.length} column headers look like dates (${dateish.slice(0, 3).join(', ')}…), so this is a staff × day grid.`,
    }
  }
  return {
    layout: 'rows',
    date_columns: dateish,
    confidence: dateish.length ? 0.6 : 0.8,
    why: dateish.length
      ? `Only ${dateish.length} date-like column header(s) — treating each row as one shift. Pass layout:"grid" if it is really a grid.`
      : 'No date-like column headers, so each row is treated as one shift.',
  }
}

/**
 * Suggest a mapping for the given headers.
 * @returns {{ layout, date_columns, mapping: Record<string,string|null>, suggestions: object[], unmapped_headers: string[], missing_required: string[] }}
 */
export function suggestMapping(headers, { layout } = {}) {
  const detected = detectLayout(headers)
  const useLayout = layout || detected.layout
  // In a grid, date columns are the values — never map them to a field.
  const candidateHeaders = useLayout === 'grid'
    ? headers.filter((h) => !detected.date_columns.includes(h))
    : [...headers]

  const scores = []
  for (const header of candidateHeaders) {
    for (const key of FIELD_KEYS) {
      const { score, why } = scoreHeaderAgainstField(header, key)
      if (score > 0) scores.push({ header, key, score, why })
    }
  }
  scores.sort((a, b) => b.score - a.score)

  const mapping = {}
  const suggestions = []
  const takenHeaders = new Set()
  const takenFields = new Set()
  for (const s of scores) {
    if (takenHeaders.has(s.header) || takenFields.has(s.key)) continue
    if (s.score < 55) continue
    mapping[s.key] = s.header
    takenHeaders.add(s.header)
    takenFields.add(s.key)
    suggestions.push({ field: s.key, header: s.header, confidence: Math.round(s.score) / 100, why: s.why })
  }
  for (const key of FIELD_KEYS) if (!(key in mapping)) mapping[key] = null

  // A grid's dates come from the headers, so work_date is satisfied structurally.
  const required = ROSTER_IMPORT_FIELDS.filter((f) => f.required).map((f) => f.key)
  const missing = required.filter((k) => {
    if (k === 'work_date' && useLayout === 'grid') return false
    return !mapping[k]
  })

  // Identity: either a code or a name is needed.
  if (!mapping.employee_code && !mapping.staff_name) missing.push('employee_code or staff_name')
  // Times: either explicit times or a shift label (grid cells carry times).
  if (useLayout === 'rows' && !mapping.shift_label && !(mapping.start_time && mapping.end_time)) {
    missing.push('start_time + end_time, or shift_label')
  }

  return {
    layout: useLayout,
    layout_detection: detected,
    date_columns: detected.date_columns,
    mapping,
    suggestions,
    unmapped_headers: candidateHeaders.filter((h) => !takenHeaders.has(h)),
    missing_required: [...new Set(missing)],
  }
}

/**
 * Canonical mapping is field → header (it is what the normaliser reads). The
 * confirmation UI needs the inverse — one row per spreadsheet column — so
 * provide both rather than making each caller flip it.
 */
export function toColumnView(headers, mapping, { dateColumns = [], suggestions = [] } = {}) {
  const byHeader = new Map()
  for (const [field, header] of Object.entries(mapping || {})) {
    if (header) byHeader.set(header, field)
  }
  const confidenceByHeader = new Map(suggestions.map((s) => [s.header, s]))
  return headers.map((header) => {
    const isDate = dateColumns.includes(header)
    const s = confidenceByHeader.get(header)
    return {
      header,
      field: isDate ? '__date_column__' : (byHeader.get(header) || null),
      is_date_column: isDate,
      confidence: s?.confidence ?? (byHeader.has(header) ? 0.5 : 0),
      why: isDate ? 'Date column — its cells become shifts' : (s?.why || null),
    }
  })
}

/** Inverse of toColumnView: what the UI sends back becomes field → header. */
export function fromColumnView(columns) {
  const mapping = {}
  for (const c of columns || []) {
    if (!c?.field || c.field === '__date_column__') continue
    mapping[c.field] = c.header
  }
  return mapping
}

/** Validate a user-supplied mapping before we run a preview on it. */
export function validateMapping(mapping, headers, layout = 'rows') {
  const errors = []
  const clean = {}
  for (const [key, header] of Object.entries(mapping || {})) {
    if (!FIELD_KEYS.includes(key)) { errors.push(`Unknown field "${key}".`); continue }
    if (header == null || header === '') { clean[key] = null; continue }
    if (!headers.includes(header)) {
      errors.push(`Field "${key}" is mapped to column "${header}", which is not in the sheet. Columns: ${headers.slice(0, 12).join(', ')}${headers.length > 12 ? '…' : ''}`)
      continue
    }
    clean[key] = header
  }
  if (!clean.employee_code && !clean.staff_name) {
    errors.push('Map either Employee Code or Staff Name so we know who each shift belongs to.')
  }
  if (layout === 'rows') {
    if (!clean.work_date) errors.push('Map the Date column.')
    if (!clean.shift_label && !(clean.start_time && clean.end_time)) {
      errors.push('Map Start Time and End Time, or a Shift/Template column.')
    }
  }
  return { ok: errors.length === 0, errors, mapping: clean }
}
