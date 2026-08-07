// Roster → tabular output, for the places rosters actually get consumed:
// Google Sheets, Airtable, and a printed page at the counter.
//
// One canonical row shape feeds every format, so the columns a manager sees in
// Sheets are the same ones Airtable gets and the same ones our importer
// recognises on the way back in. That round-trip property is the point: an
// exported sheet can be edited by hand and re-imported without remapping.

/** Canonical column order. Stable — downstream sheets and Airtable bases key off it. */
export const EXPORT_COLUMNS = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'day', label: 'Day', type: 'text' },
  { key: 'employee_code', label: 'Employee Code', type: 'text' },
  { key: 'staff', label: 'Staff', type: 'text' },
  { key: 'title', label: 'Title', type: 'text' },
  { key: 'start', label: 'Start', type: 'time' },
  { key: 'end', label: 'End', type: 'time' },
  { key: 'break_minutes', label: 'Break (min)', type: 'number' },
  { key: 'hours', label: 'Hours', type: 'number' },
  { key: 'job_code', label: 'Job Code', type: 'text' },
  { key: 'store', label: 'Store', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
]

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function sgTime(iso) {
  return new Date(iso).toLocaleTimeString('en-SG', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore',
  })
}

function netHours(startIso, endIso, breakMinutes) {
  const h = (new Date(endIso).getTime() - new Date(startIso).getTime()) / 3600000 - (breakMinutes || 0) / 60
  return Math.round(h * 100) / 100
}

/**
 * Normalise shifts (DB rows or generated proposals) into export rows.
 * @param {Array} shifts
 * @param {{ storeName?: string, status?: string }} ctx
 */
export function toExportRows(shifts, ctx = {}) {
  return (shifts || [])
    .map((sh) => {
      const startIso = sh.start_at || sh.start
      const endIso = sh.end_at || sh.end
      const isIso = String(startIso).includes('T')
      const date = sh.work_date
      return {
        date,
        day: DOW[new Date(`${date}T00:00:00Z`).getUTCDay()],
        employee_code: sh.employee_code || sh.staff?.employee_code || '',
        staff: sh.display_name || sh.staff?.display_name || '(open shift)',
        title: sh.display_title || sh.staff?.display_title || '',
        start: isIso ? sgTime(startIso) : String(startIso).slice(0, 5),
        end: isIso ? sgTime(endIso) : String(endIso).slice(0, 5),
        break_minutes: sh.break_minutes ?? 0,
        hours: sh.hours ?? (isIso ? netHours(startIso, endIso, sh.break_minutes) : null),
        job_code: sh.job_code || '',
        store: ctx.storeName || sh.store?.name || '',
        status: sh.staff_id || sh.employee_code ? (ctx.status || sh.status || 'scheduled') : 'OPEN',
      }
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start) || String(a.employee_code).localeCompare(String(b.employee_code)))
}

function escapeDelimited(value, delimiter) {
  const s = value == null ? '' : String(value)
  if (delimiter === '\t') return s.replace(/[\t\n\r]/g, ' ')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** CSV, or TSV for pasting straight into a Sheets selection. */
export function toDelimited(rows, { delimiter = ',', columns = EXPORT_COLUMNS } = {}) {
  const header = columns.map((c) => escapeDelimited(c.label, delimiter)).join(delimiter)
  const body = rows.map((r) => columns.map((c) => escapeDelimited(r[c.key], delimiter)).join(delimiter))
  return [header, ...body].join('\n')
}

/**
 * Airtable's create-records payload. Labels are used as field names so the
 * base's columns can be created by copying EXPORT_COLUMNS.
 */
export function toAirtableRecords(rows, { columns = EXPORT_COLUMNS } = {}) {
  return rows.map((r) => ({
    fields: Object.fromEntries(
      columns
        .map((c) => [c.label, r[c.key]])
        .filter(([, v]) => v !== '' && v !== null && v !== undefined),
    ),
  }))
}

/**
 * The staff × day grid most stores actually keep in Sheets: one row per
 * person, one column per date, cell = "09:30-18:30".
 */
export function toGrid(rows, { weekStart, days = 7 } = {}) {
  const dates = []
  if (weekStart) {
    for (let i = 0; i < days; i++) {
      const d = new Date(`${weekStart}T00:00:00Z`)
      d.setUTCDate(d.getUTCDate() + i)
      dates.push(d.toISOString().slice(0, 10))
    }
  } else {
    for (const d of [...new Set(rows.map((r) => r.date))].sort()) dates.push(d)
  }

  const byStaff = new Map()
  for (const r of rows) {
    const key = r.employee_code || r.staff
    const entry = byStaff.get(key) || { employee_code: r.employee_code, staff: r.staff, title: r.title, cells: {} }
    const cell = `${r.start}-${r.end}`
    entry.cells[r.date] = entry.cells[r.date] ? `${entry.cells[r.date]} / ${cell}` : cell
    byStaff.set(key, entry)
  }

  const header = ['Employee Code', 'Staff', ...dates.map((d) => {
    const dow = DOW[new Date(`${d}T00:00:00Z`).getUTCDay()]
    return `${dow} ${d.slice(8)}/${d.slice(5, 7)}`
  })]

  const body = [...byStaff.values()]
    .sort((a, b) => String(a.employee_code).localeCompare(String(b.employee_code)))
    .map((s) => [s.employee_code || '', s.staff, ...dates.map((d) => s.cells[d] || 'OFF')])

  return { dates, header, rows: body }
}

export function gridToDelimited(grid, delimiter = '\t') {
  return [grid.header, ...grid.rows]
    .map((r) => r.map((v) => escapeDelimited(v, delimiter)).join(delimiter))
    .join('\n')
}

/**
 * One entry point for every format an agent might be asked for.
 * @param {'records'|'csv'|'tsv'|'airtable'|'grid'|'grid_tsv'|'markdown'} format
 */
export function formatRoster(shifts, { format = 'records', storeName, weekStart, status } = {}) {
  const rows = toExportRows(shifts, { storeName, status })
  switch (format) {
    case 'csv':
      return { format, content_type: 'text/csv', data: toDelimited(rows, { delimiter: ',' }), row_count: rows.length }
    case 'tsv':
      return {
        format, content_type: 'text/tab-separated-values',
        data: toDelimited(rows, { delimiter: '\t' }), row_count: rows.length,
        note: 'Tab-separated — paste directly into a Google Sheets cell selection.',
      }
    case 'airtable':
      return {
        format, records: toAirtableRecords(rows), row_count: rows.length,
        note: 'POST in batches of 10 to https://api.airtable.com/v0/{baseId}/{tableName} as { "records": [...] }. Field names match the column labels.',
        field_schema: EXPORT_COLUMNS.map((c) => ({ name: c.label, type: c.type })),
      }
    case 'grid': {
      const grid = toGrid(rows, { weekStart })
      return { format, ...grid, row_count: grid.rows.length }
    }
    case 'grid_tsv': {
      const grid = toGrid(rows, { weekStart })
      return {
        format, content_type: 'text/tab-separated-values',
        data: gridToDelimited(grid), row_count: grid.rows.length,
        note: 'Staff × day grid, tab-separated — paste into Sheets. "OFF" marks a non-working day.',
      }
    }
    case 'markdown': {
      const grid = toGrid(rows, { weekStart })
      const line = (cells) => `| ${cells.join(' | ')} |`
      return {
        format,
        data: [line(grid.header), line(grid.header.map(() => '---')), ...grid.rows.map(line)].join('\n'),
        row_count: grid.rows.length,
      }
    }
    default:
      return { format: 'records', columns: EXPORT_COLUMNS, rows, row_count: rows.length }
  }
}
