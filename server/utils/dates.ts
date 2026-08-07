// Date helpers. All Fran stores run Asia/Singapore (UTC+8); work_date is
// always the SGT calendar date.

export function sgToday(): string {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

export function sgNow(): Date {
  return new Date()
}

export function assertDate(value: unknown, name: string): string {
  const s = String(value || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    throw apiError(400, `${name} must be YYYY-MM-DD`)
  }
  return s
}

export function assertTime(value: unknown, name: string): string {
  const s = String(value || '').trim()
  if (!/^\d{2}:\d{2}$/.test(s)) {
    throw apiError(400, `${name} must be HH:MM`)
  }
  return s
}

/** Combine a work date + local SGT time into a timestamptz ISO string. */
export function sgTimestamp(date: string, time: string): string {
  return `${date}T${time}:00+08:00`
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

export function csvEscape(v: unknown): string {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
