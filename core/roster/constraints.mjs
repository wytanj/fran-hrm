// Constraint spec for roster generation: normalisation, validation, and a
// human-readable explanation of what a set actually says.
//
// Written to be agent-friendly. An LLM supplies a constraint object in one
// shot, so the validator's job is to (a) accept loose input — weekday names in
// any case, times as "9:30" or "09:30", counts as strings — and (b) explain
// precisely what it rejected, because the agent's only way to recover is the
// error message.

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']

const WEEKDAY_ALIASES = {
  mon: 'mon', monday: 'mon', m: 'mon',
  tue: 'tue', tues: 'tue', tuesday: 'tue', t: 'tue',
  wed: 'wed', weds: 'wed', wednesday: 'wed', w: 'wed',
  thu: 'thu', thur: 'thu', thurs: 'thu', thursday: 'thu', th: 'thu',
  fri: 'fri', friday: 'fri', f: 'fri',
  sat: 'sat', saturday: 'sat', sa: 'sat',
  sun: 'sun', sunday: 'sun', su: 'sun',
  weekday: 'weekday', weekdays: 'weekday',
  weekend: 'weekend', weekends: 'weekend',
  daily: 'daily', all: 'daily', everyday: 'daily', every_day: 'daily',
}

export const DEFAULT_RULES = {
  max_consecutive_days: 6,
  min_rest_hours_between_shifts: 10,
  off_days_per_week: 1,
  respect_availability: true,
  respect_leave: true,
  respect_pt_caps: true,
  weekly_ot_threshold_hours: 44,
  max_hours_per_day: 12,
}

export const DEFAULT_PREFERENCES = {
  fair_weekend_rotation: true,
  prefer_preferred_availability: true,
  balance_hours: true,
  keep_pairs: [],
  avoid_pairs: [],
}

export function normaliseWeekday(value) {
  const key = String(value || '').trim().toLowerCase().replace(/[^a-z_]/g, '')
  return WEEKDAY_ALIASES[key] || null
}

/** "9:30", "0930", "9.30am" → "09:30". Returns null when unparseable. */
export function normaliseTime(value) {
  const raw = String(value ?? '').trim().toLowerCase()
  if (!raw) return null
  const ampm = /(am|pm)$/.exec(raw)?.[1]
  const digits = raw.replace(/(am|pm)$/, '').replace(/[^0-9]/g, '')
  let h
  let m = 0
  if (digits.length <= 2) h = Number(digits)
  else if (digits.length === 3) { h = Number(digits.slice(0, 1)); m = Number(digits.slice(1)) }
  else { h = Number(digits.slice(0, 2)); m = Number(digits.slice(2, 4)) }
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  if (ampm === 'pm' && h < 12) h += 12
  if (ampm === 'am' && h === 12) h = 0
  if (h > 23 || m > 59) return null
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

export function minutesOf(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number)
  return h * 60 + m
}

/** Expand 'daily' / 'weekday' / 'weekend' into concrete weekdays. */
function expandWeekday(token) {
  if (token === 'daily') return [...WEEKDAYS]
  if (token === 'weekday') return WEEKDAYS.slice(0, 5)
  if (token === 'weekend') return WEEKDAYS.slice(5)
  return [token]
}

/**
 * Normalise and validate a constraint set.
 *
 * @param {object} input raw constraints (from an agent, the UI, or the DB)
 * @param {{ templates?: Array<{name:string,start_time:string,end_time:string,break_minutes:number}> }} ctx
 * @returns {{ ok: boolean, errors: string[], warnings: string[], constraints: object }}
 */
export function validateConstraints(input, ctx = {}) {
  const errors = []
  const warnings = []
  const templates = ctx.templates || []
  const templateByName = new Map(templates.map((t) => [String(t.name).toLowerCase(), t]))

  const src = input && typeof input === 'object' ? input : {}

  // ── coverage ──
  const coverage = []
  const rawCoverage = Array.isArray(src.coverage) ? src.coverage : []
  if (!rawCoverage.length) {
    errors.push('coverage is required: say who is needed on which days. Example: coverage: [{ weekday: "daily", blocks: [{ template: "Opening", count: 2 }] }]')
  }

  for (const [i, entry] of rawCoverage.entries()) {
    const at = `coverage[${i}]`
    const token = normaliseWeekday(entry?.weekday ?? entry?.day)
    if (!token) {
      errors.push(`${at}.weekday "${entry?.weekday ?? entry?.day}" is not a weekday. Use mon…sun, or daily / weekday / weekend.`)
      continue
    }
    const blocks = Array.isArray(entry?.blocks) ? entry.blocks : []
    if (!blocks.length) {
      errors.push(`${at}.blocks is empty — each day needs at least one block of cover.`)
      continue
    }

    const normalisedBlocks = []
    for (const [j, block] of blocks.entries()) {
      const bAt = `${at}.blocks[${j}]`
      let start = normaliseTime(block?.start ?? block?.start_time)
      let end = normaliseTime(block?.end ?? block?.end_time)
      let breakMinutes = block?.break_minutes
      let templateName = block?.template || block?.template_name || null

      if (templateName) {
        const tpl = templateByName.get(String(templateName).toLowerCase())
        if (!tpl) {
          const known = templates.map((t) => t.name).join(', ') || '(none configured)'
          errors.push(`${bAt}.template "${templateName}" is not a shift template. Known templates: ${known}. Or give explicit start and end times.`)
          continue
        }
        start = start || String(tpl.start_time).slice(0, 5)
        end = end || String(tpl.end_time).slice(0, 5)
        breakMinutes = breakMinutes ?? tpl.break_minutes
        templateName = tpl.name
      }

      if (!start || !end) {
        errors.push(`${bAt} needs either a template name, or start and end times (HH:MM).`)
        continue
      }
      if (minutesOf(end) <= minutesOf(start)) {
        errors.push(`${bAt}: end (${end}) must be after start (${start}). Overnight shifts are not supported yet.`)
        continue
      }

      const count = Math.max(1, Math.floor(Number(block?.count ?? block?.headcount ?? 1)) || 1)
      normalisedBlocks.push({
        template: templateName,
        start,
        end,
        break_minutes: Math.max(0, Number(breakMinutes) || 0),
        count,
        job_code: block?.job_code || null,
        // Restrict a block to particular people or an employment type.
        only_staff: toCodeArray(block?.only_staff),
        employment_type: normaliseEmploymentType(block?.employment_type),
      })
    }

    for (const day of expandWeekday(token)) {
      const existing = coverage.find((c) => c.weekday === day)
      if (existing) existing.blocks.push(...normalisedBlocks)
      else coverage.push({ weekday: day, blocks: [...normalisedBlocks] })
    }
  }

  // ── rules ──
  const rawRules = src.rules && typeof src.rules === 'object' ? src.rules : {}
  const rules = { ...DEFAULT_RULES }
  for (const [key, value] of Object.entries(rawRules)) {
    if (!(key in DEFAULT_RULES)) {
      warnings.push(`Unknown rule "${key}" ignored. Supported: ${Object.keys(DEFAULT_RULES).join(', ')}.`)
      continue
    }
    if (typeof DEFAULT_RULES[key] === 'boolean') rules[key] = !!value
    else {
      const n = Number(value)
      if (!Number.isFinite(n) || n < 0) { errors.push(`rules.${key} must be a non-negative number (got ${value}).`); continue }
      rules[key] = n
    }
  }
  if (rules.off_days_per_week > 6) errors.push('rules.off_days_per_week cannot exceed 6 — nobody would ever work.')
  if (rules.max_consecutive_days < 1) errors.push('rules.max_consecutive_days must be at least 1.')

  // ── preferences ──
  const rawPrefs = src.preferences && typeof src.preferences === 'object' ? src.preferences : {}
  const preferences = { ...DEFAULT_PREFERENCES }
  for (const [key, value] of Object.entries(rawPrefs)) {
    if (!(key in DEFAULT_PREFERENCES)) {
      warnings.push(`Unknown preference "${key}" ignored. Supported: ${Object.keys(DEFAULT_PREFERENCES).join(', ')}.`)
      continue
    }
    if (Array.isArray(DEFAULT_PREFERENCES[key])) {
      preferences[key] = (Array.isArray(value) ? value : [])
        .map((pair) => toCodeArray(pair)).filter((p) => p.length === 2)
    } else preferences[key] = !!value
  }

  // ── staff narrowing ──
  const rawStaff = src.staff && typeof src.staff === 'object' ? src.staff : {}
  const staff = {
    include: toCodeArray(rawStaff.include),
    exclude: toCodeArray(rawStaff.exclude),
    must_work: {},
    max_shifts: {},
  }
  for (const [code, days] of Object.entries(rawStaff.must_work || {})) {
    const list = (Array.isArray(days) ? days : [days]).map(normaliseWeekday).filter(Boolean)
    if (list.length) staff.must_work[String(code).toUpperCase()] = list
  }
  for (const [code, n] of Object.entries(rawStaff.max_shifts || {})) {
    const v = Math.floor(Number(n))
    if (Number.isFinite(v) && v >= 0) staff.max_shifts[String(code).toUpperCase()] = v
  }

  const totalSlots = coverage.reduce((sum, c) => sum + c.blocks.reduce((s, b) => s + b.count, 0), 0)
  if (!errors.length && totalSlots === 0) errors.push('The constraints describe zero shifts. Check your block counts.')

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    constraints: { coverage, rules, preferences, staff },
    slot_count: totalSlots,
  }
}

function toCodeArray(value) {
  if (!value) return []
  const list = Array.isArray(value) ? value : String(value).split(/[,\s]+/)
  return list.map((v) => String(v).trim().toUpperCase()).filter(Boolean)
}

function normaliseEmploymentType(value) {
  const v = String(value || '').trim().toLowerCase().replace(/[\s-]/g, '_')
  if (['full_time', 'ft', 'fulltime'].includes(v)) return 'full_time'
  if (['part_time', 'pt', 'parttime'].includes(v)) return 'part_time'
  return null
}

/** Plain-English summary, so a manager can check what an agent asked for. */
export function explainConstraints(c) {
  const lines = []
  const slots = (c.coverage || []).reduce((s, d) => s + d.blocks.reduce((x, b) => x + b.count, 0), 0)
  lines.push(`${slots} shift slot(s) across ${(c.coverage || []).length} day(s).`)
  for (const day of c.coverage || []) {
    const parts = day.blocks.map((b) => {
      const who = b.employment_type ? ` ${b.employment_type === 'part_time' ? 'PT' : 'FT'}` : ''
      const only = b.only_staff?.length ? ` [${b.only_staff.join('/')}]` : ''
      return `${b.count}×${who} ${b.template || `${b.start}-${b.end}`}${only}`
    })
    lines.push(`  ${day.weekday}: ${parts.join(', ')}`)
  }
  const r = c.rules || {}
  lines.push(`Rules: max ${r.max_consecutive_days} consecutive days, ${r.off_days_per_week} off day(s)/week, ${r.min_rest_hours_between_shifts}h rest between shifts, OT flagged past ${r.weekly_ot_threshold_hours}h.`)
  const hard = []
  if (r.respect_leave) hard.push('approved/pending leave')
  if (r.respect_availability) hard.push('stated availability')
  if (r.respect_pt_caps) hard.push('PT hour caps')
  if (hard.length) lines.push(`Treated as hard limits: ${hard.join(', ')}.`)
  return lines.join('\n')
}
