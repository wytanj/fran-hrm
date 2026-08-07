// CSV/TSV → headers + row objects, tolerant of the mess real roster sheets
// carry: a title line above the table, blank spacer rows, merged-looking cells,
// duplicate column names.
//
// Same doctrine as fran-skums' parse.mjs: find the header row rather than
// assuming line 1, make headers unique, and never throw on a ragged row.

/** RFC4180-ish single line split, honouring quotes. */
export function parseDelimitedLine(line, delimiter = ',') {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else quoted = false
      } else cur += c
    } else if (c === '"') quoted = true
    else if (c === delimiter) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out.map((s) => String(s ?? '').trim())
}

export function detectDelimiter(text) {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n')
  const counts = { '\t': 0, ',': 0, ';': 0 }
  for (const d of Object.keys(counts)) counts[d] = (sample.match(new RegExp(d === '\t' ? '\t' : d, 'g')) || []).length
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]
  return best[1] > 0 ? best[0] : ','
}

export function makeUniqueHeaders(headers) {
  const counts = new Map()
  return headers.map((header, index) => {
    const base = String(header || '').replace(/\s+/g, ' ').trim() || `Column ${index + 1}`
    const seen = counts.get(base) || 0
    counts.set(base, seen + 1)
    return seen === 0 ? base : `${base} ${seen + 1}`
  })
}

/**
 * Pick the header row: the first row in the first 15 that has at least two
 * non-empty cells and looks least like data (few pure numbers).
 */
function findHeaderIndex(rows) {
  let best = -1
  let bestScore = -Infinity
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const cells = rows[i].filter((c) => c !== '')
    if (cells.length < 2) continue
    const numeric = cells.filter((c) => /^-?\d+(\.\d+)?$/.test(c)).length
    const wordy = cells.filter((c) => /[a-z]/i.test(c)).length
    // Prefer wide, wordy, non-numeric rows.
    const score = cells.length * 2 + wordy * 2 - numeric * 3 - i
    if (score > bestScore) { bestScore = score; best = i }
  }
  return best === -1 ? 0 : best
}

/**
 * @param {string} text raw csv/tsv content
 * @param {{ delimiter?: string, headerIndex?: number, maxRows?: number }} [opts]
 * @returns {{ headers: string[], rows: object[], headerIndex: number, delimiter: string, skippedRows: number, totalLines: number }}
 */
export function parseSheet(text, opts = {}) {
  const clean = String(text || '').replace(/^﻿/, '')
  const delimiter = opts.delimiter || detectDelimiter(clean)
  const lines = clean.split(/\r?\n/)
  const grid = lines.map((l) => parseDelimitedLine(l, delimiter))

  // Drop wholly empty trailing/leading lines but remember the offset.
  const headerIndex = opts.headerIndex ?? findHeaderIndex(grid)
  const headers = makeUniqueHeaders(grid[headerIndex] || [])

  const rows = []
  let skipped = 0
  const maxRows = opts.maxRows || 5000
  for (let i = headerIndex + 1; i < grid.length && rows.length < maxRows; i++) {
    const cells = grid[i]
    if (!cells.some((c) => c !== '')) { skipped += 1; continue }
    const obj = { __row: i + 1 }
    headers.forEach((h, idx) => { obj[h] = cells[idx] ?? '' })
    rows.push(obj)
  }

  return {
    headers,
    rows,
    headerIndex,
    delimiter,
    skippedRows: skipped,
    totalLines: grid.length,
  }
}
