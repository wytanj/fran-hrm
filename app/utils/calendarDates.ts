// Client-side date math for calendar nav. Mirror of server/utils/dates.ts
// (addDays / mondayOf / sgToday) without server-only globals. All values are
// YYYY-MM-DD on the Singapore calendar (UTC+8); weeks start Monday.

export type CalendarMode = 'day' | 'week' | 'month'

/** How far navigation may travel from today. Inclusive on the anchor date. */
export const NAV_MONTHS = 12

export function todaySG(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function mondayOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

export function addMonths(date: string, n: number): string {
  const [y, m, day] = date.split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = ((total % 12) + 12) % 12
  const last = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  const d = Math.min(day, last)
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`
}

export function endOfMonth(date: string): string {
  const [y, m] = date.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`
}

export function eachDate(from: string, to: string): string[] {
  if (from > to) return []
  const out: string[] = []
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d)
  return out
}

/** Monday-start weeks covering the month of `anchor`, including leading/trailing days. */
export function monthWeeks(anchor: string): string[][] {
  const monthStart = startOfMonth(anchor)
  const monthEnd = endOfMonth(anchor)
  const gridStart = mondayOf(monthStart)
  const gridEnd = addDays(mondayOf(monthEnd), 6)
  const days = eachDate(gridStart, gridEnd)
  const weeks: string[][] = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  return weeks
}

export function visibleRange(mode: CalendarMode, anchor: string): { start: string; end: string } {
  if (mode === 'day') return { start: anchor, end: anchor }
  if (mode === 'week') {
    const start = mondayOf(anchor)
    return { start, end: addDays(start, 6) }
  }
  return { start: startOfMonth(anchor), end: endOfMonth(anchor) }
}

export function stepAnchor(mode: CalendarMode, anchor: string, dir: 1 | -1): string {
  if (mode === 'day') return addDays(anchor, dir)
  if (mode === 'week') return addDays(anchor, dir * 7)
  return addMonths(anchor, dir)
}

export function navWindow(today: string = todaySG()): { min: string; max: string } {
  return { min: addMonths(today, -NAV_MONTHS), max: addMonths(today, NAV_MONTHS) }
}

export function clampDate(date: string, min: string, max: string): string {
  if (date < min) return min
  if (date > max) return max
  return date
}

export function canStep(
  mode: CalendarMode,
  anchor: string,
  dir: 1 | -1,
  min: string,
  max: string,
): boolean {
  const next = stepAnchor(mode, anchor, dir)
  return next >= min && next <= max
}

/** Same tone as roster.vue's original weekLabel (`24 Aug – 30 Aug`). */
export function formatDayShort(date: string): string {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-SG', {
    day: 'numeric', month: 'short', timeZone: 'UTC',
  })
}

export function formatRangeLabel(mode: CalendarMode, start: string, end: string): string {
  if (mode === 'day') {
    return new Date(`${start}T00:00:00Z`).toLocaleDateString('en-SG', {
      weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC',
    })
  }
  if (mode === 'week') return `${formatDayShort(start)} – ${formatDayShort(end)}`
  return new Date(`${start}T00:00:00Z`).toLocaleDateString('en-SG', {
    month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

export function dateParts(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  return {
    dow: d.toLocaleDateString('en-SG', { weekday: 'short', timeZone: 'UTC' }),
    dowLong: d.toLocaleDateString('en-SG', { weekday: 'long', timeZone: 'UTC' }),
    dayNum: String(Number(date.slice(8))),
    month: d.toLocaleDateString('en-SG', { month: 'short', timeZone: 'UTC' }),
    label: d.toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }),
  }
}
