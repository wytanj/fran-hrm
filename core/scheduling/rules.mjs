// Scheduling rules — the versioned artifact that fixates bot + HRM policy.
//
// Source of truth for DEFAULTS is config/scheduling_rules.json (human copy:
// docs/SCHEDULING_RULES.md). A workspace may override the whole document in
// workspace_scheduling_rules (migration 031) so Jarell can edit from the admin
// page without a deploy; the file is what a fresh workspace starts from.
//
// DEFAULT_SCHEDULING_RULES below must stay byte-equal in meaning to the JSON
// file — tests/scheduling-rules.test.mjs fails on drift. The constant exists
// because on Vercel the bundled server has no config/ directory on disk: the
// file is read when it is there (local dev, MCP stdio, tests) and the constant
// is the fallback when it is not.
//
// Shared by REST routes, the Telegram bot and MCP tools — change behaviour
// here, not in a route.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { recordAudit } from '../audit/record.mjs'

export const DEFAULT_SCHEDULING_RULES = Object.freeze({
  version: 1,
  store_ids: ['SGP-BUGIS-001'],
  availability: {
    open_day_of_prior_month: 1,
    lock_day_of_prior_month: 7,
    reminders: ['open', 'T-3d', 'T-1d', 'locked'],
  },
  publish: {
    target_day_of_prior_month: 15,
    guardrails: ['leave_block', 'ot_warn', 'rest_warn', 'pt_cap_warn'],
  },
  cover: {
    planned_swap_min_days: 3,
    urgent_auto_accept_first_claim: true,
    escalate_hours_before_start: 3,
    mc_auto_open_cover: true,
  },
  pricing: {
    default_basis: 'staff_hourly',
    template_multipliers: { opening: 1.0, closing: 1.15 },
  },
  pay: {
    v1_basis: 'clock_actuals_with_scheduled_fallback',
  },
  telegram: {
    pilot: true,
    require_linked_identity: true,
  },
})

export const REMINDER_TOKEN = /^(open|locked|T-(\d{1,2})d)$/
export const GUARDRAILS = ['leave_block', 'ot_warn', 'rest_warn', 'pt_cap_warn']
export const PRICING_BASES = ['staff_hourly', 'template_flat']
export const PAY_BASES = ['clock_actuals_with_scheduled_fallback', 'scheduled_only', 'clock_actuals_only']

const RULES_FILE = fileURLToPath(new URL('../../config/scheduling_rules.json', import.meta.url))

// ───────────────────────── validation ─────────────────────────

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v)
}

function intBetween(v, min, max) {
  return Number.isInteger(v) && v >= min && v <= max
}

/**
 * Validate a rules document. Returns { ok, errors, value } where value is a
 * normalised deep copy (numbers coerced from numeric strings, lists de-duped)
 * so the caller can persist it as-is. Errors are actionable sentences that
 * name the exact field, because the admin form and the PUT route surface
 * them verbatim.
 */
export function validateSchedulingRules(input) {
  const errors = []
  if (!isPlainObject(input)) {
    return { ok: false, errors: ['Rules must be a JSON object.'], value: null }
  }
  const num = (v) => (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : v)
  const out = {}

  const version = num(input.version)
  if (!intBetween(version, 1, 1_000_000)) errors.push('version must be a positive integer.')
  out.version = version

  if (!Array.isArray(input.store_ids) || input.store_ids.some((s) => typeof s !== 'string' || !s.trim())) {
    errors.push('store_ids must be a list of store codes (strings). Use an empty list for "every store".')
    out.store_ids = []
  } else {
    out.store_ids = [...new Set(input.store_ids.map((s) => s.trim()))]
  }

  const av = isPlainObject(input.availability) ? input.availability : {}
  const openDay = num(av.open_day_of_prior_month)
  const lockDay = num(av.lock_day_of_prior_month)
  if (!intBetween(openDay, 1, 28)) errors.push('availability.open_day_of_prior_month must be a day 1–28 (28 so it exists in February).')
  if (!intBetween(lockDay, 1, 28)) errors.push('availability.lock_day_of_prior_month must be a day 1–28.')
  if (intBetween(openDay, 1, 28) && intBetween(lockDay, 1, 28) && lockDay < openDay) {
    errors.push('availability.lock_day_of_prior_month must be on or after open_day_of_prior_month.')
  }
  let reminders = Array.isArray(av.reminders) ? av.reminders : null
  if (!reminders) {
    errors.push('availability.reminders must be a list, e.g. ["open", "T-3d", "T-1d", "locked"].')
    reminders = []
  } else {
    for (const r of reminders) {
      if (typeof r !== 'string' || !REMINDER_TOKEN.test(r)) {
        errors.push(`availability.reminders contains "${r}" — allowed: "open", "locked", or "T-<n>d" (n days before lock).`)
      }
    }
    reminders = [...new Set(reminders)]
  }
  out.availability = { open_day_of_prior_month: openDay, lock_day_of_prior_month: lockDay, reminders }

  const pub = isPlainObject(input.publish) ? input.publish : {}
  const target = num(pub.target_day_of_prior_month)
  if (!intBetween(target, 1, 28)) errors.push('publish.target_day_of_prior_month must be a day 1–28.')
  if (intBetween(target, 1, 28) && intBetween(lockDay, 1, 28) && target < lockDay) {
    errors.push('publish.target_day_of_prior_month must be on or after availability.lock_day_of_prior_month — you cannot publish before availability closes.')
  }
  let guardrails = Array.isArray(pub.guardrails) ? pub.guardrails : null
  if (!guardrails) {
    errors.push(`publish.guardrails must be a list drawn from: ${GUARDRAILS.join(', ')}.`)
    guardrails = []
  } else {
    for (const g of guardrails) {
      if (!GUARDRAILS.includes(g)) errors.push(`publish.guardrails contains "${g}" — allowed: ${GUARDRAILS.join(', ')}.`)
    }
    guardrails = [...new Set(guardrails)]
  }
  out.publish = { target_day_of_prior_month: target, guardrails }

  const cover = isPlainObject(input.cover) ? input.cover : {}
  const swapMin = num(cover.planned_swap_min_days)
  const escalate = num(cover.escalate_hours_before_start)
  if (!intBetween(swapMin, 0, 60)) errors.push('cover.planned_swap_min_days must be a whole number of days (0–60).')
  if (!intBetween(escalate, 0, 168)) errors.push('cover.escalate_hours_before_start must be a whole number of hours (0–168).')
  if (typeof cover.urgent_auto_accept_first_claim !== 'boolean') errors.push('cover.urgent_auto_accept_first_claim must be true or false.')
  if (typeof cover.mc_auto_open_cover !== 'boolean') errors.push('cover.mc_auto_open_cover must be true or false.')
  out.cover = {
    planned_swap_min_days: swapMin,
    urgent_auto_accept_first_claim: cover.urgent_auto_accept_first_claim,
    escalate_hours_before_start: escalate,
    mc_auto_open_cover: cover.mc_auto_open_cover,
  }

  const pricing = isPlainObject(input.pricing) ? input.pricing : {}
  if (!PRICING_BASES.includes(pricing.default_basis)) {
    errors.push(`pricing.default_basis must be one of: ${PRICING_BASES.join(', ')}.`)
  }
  const mult = {}
  if (!isPlainObject(pricing.template_multipliers)) {
    errors.push('pricing.template_multipliers must be an object of template name → multiplier, e.g. { "closing": 1.15 }.')
  } else {
    for (const [k, v] of Object.entries(pricing.template_multipliers)) {
      const n = num(v)
      if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 10) {
        errors.push(`pricing.template_multipliers.${k} must be a number between 0 and 10.`)
      }
      mult[k] = n
    }
  }
  out.pricing = { default_basis: pricing.default_basis, template_multipliers: mult }

  const pay = isPlainObject(input.pay) ? input.pay : {}
  if (!PAY_BASES.includes(pay.v1_basis)) errors.push(`pay.v1_basis must be one of: ${PAY_BASES.join(', ')}.`)
  out.pay = { v1_basis: pay.v1_basis }

  const tg = isPlainObject(input.telegram) ? input.telegram : {}
  if (typeof tg.pilot !== 'boolean') errors.push('telegram.pilot must be true or false.')
  if (typeof tg.require_linked_identity !== 'boolean') errors.push('telegram.require_linked_identity must be true or false.')
  out.telegram = { pilot: tg.pilot, require_linked_identity: tg.require_linked_identity }

  return { ok: errors.length === 0, errors, value: errors.length ? null : out }
}

/**
 * Overlay a partial document onto a full one, one level deep per section.
 * Used so a workspace override saved against version 1 still picks up a key
 * that a later default adds, without the admin having to re-save.
 */
export function mergeSchedulingRules(base, override) {
  if (!isPlainObject(override)) return structuredClone(base)
  const out = structuredClone(base)
  for (const [k, v] of Object.entries(override)) {
    if (isPlainObject(v) && isPlainObject(out[k])) out[k] = { ...out[k], ...structuredClone(v) }
    else out[k] = structuredClone(v)
  }
  return out
}

// ───────────────────────── file defaults ─────────────────────────

let fileCache = null // { rules, source, path }

/** Read + validate config/scheduling_rules.json; fall back to the constant. */
export function loadSchedulingRulesFile({ force = false } = {}) {
  if (fileCache && !force) return fileCache
  let parsed = null
  let source = 'builtin'
  try {
    parsed = JSON.parse(readFileSync(RULES_FILE, 'utf8'))
    source = 'file'
  } catch {
    parsed = null
  }
  if (parsed) {
    const { ok, errors, value } = validateSchedulingRules(parsed)
    if (!ok) {
      console.error(`[scheduling-rules] ${RULES_FILE} is invalid, using built-in defaults:\n- ${errors.join('\n- ')}`)
      parsed = null
      source = 'builtin'
    } else {
      parsed = value
    }
  }
  fileCache = { rules: parsed || structuredClone(DEFAULT_SCHEDULING_RULES), source, path: RULES_FILE }
  return fileCache
}

/** The default rules (file if present and valid, else the built-in copy). */
export function getSchedulingRules() {
  return loadSchedulingRulesFile().rules
}

/** Drop caches (file + every workspace override). */
export function reloadSchedulingRules() {
  fileCache = null
  wsCache.clear()
  return loadSchedulingRulesFile({ force: true }).rules
}

// ───────────────────────── workspace override ─────────────────────────

const wsCache = new Map() // workspaceId → { at, value }
const WS_TTL_MS = 60_000

export function invalidateSchedulingRulesCache(workspaceId) {
  if (workspaceId) wsCache.delete(workspaceId)
  else wsCache.clear()
}

/**
 * Effective rules for a workspace: file defaults overlaid with the DB row.
 * Returns { rules, version, source: 'workspace'|'defaults', updated_at, updated_by }.
 */
export async function getWorkspaceSchedulingRules(db, workspaceId, { fresh = false } = {}) {
  if (!workspaceId) throw new Error('workspaceId is required')
  const cached = wsCache.get(workspaceId)
  if (cached && !fresh && Date.now() - cached.at < WS_TTL_MS) return cached.value
  const defaults = getSchedulingRules()
  const { data, error } = await db
    .from('workspace_scheduling_rules')
    .select('version, rules, updated_at, updated_by, updated_by_staff:updated_by(display_name)')
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  let value
  if (data?.rules) {
    const merged = mergeSchedulingRules(defaults, data.rules)
    merged.version = data.version
    value = {
      rules: merged,
      version: data.version,
      source: 'workspace',
      updated_at: data.updated_at,
      updated_by: data.updated_by,
      updated_by_name: data.updated_by_staff?.display_name || null,
    }
  } else {
    value = {
      rules: structuredClone(defaults),
      version: defaults.version,
      source: 'defaults',
      updated_at: null,
      updated_by: null,
      updated_by_name: null,
    }
  }
  wsCache.set(workspaceId, { at: Date.now(), value })
  return value
}

/**
 * Save a workspace override. Validates, bumps version (previous + 1, never
 * below the file default), writes audit before/after. Throws on invalid
 * input with the joined error list in the message.
 */
export async function saveWorkspaceSchedulingRules(db, workspaceId, input, actor = {}) {
  const current = await getWorkspaceSchedulingRules(db, workspaceId, { fresh: true })
  const candidate = mergeSchedulingRules(current.rules, input)
  candidate.version = current.version + 1
  const { ok, errors, value } = validateSchedulingRules(candidate)
  if (!ok) {
    const err = new Error(`Scheduling rules were not saved:\n- ${errors.join('\n- ')}`)
    err.errors = errors
    throw err
  }
  const now = new Date().toISOString()
  const { error } = await db.from('workspace_scheduling_rules').upsert({
    workspace_id: workspaceId,
    version: value.version,
    rules: value,
    updated_at: now,
    updated_by: actor.staff_id || null,
  }, { onConflict: 'workspace_id' })
  if (error) throw new Error(error.message)

  await recordAudit(db, {
    workspace_id: workspaceId,
    actor_kind: actor.actor_kind || 'user',
    actor_id: actor.actor_id || null,
    actor_name: actor.actor_name || null,
    source_type: actor.source_type || 'web',
    object_type: 'scheduling_rules',
    entity_id: workspaceId,
    operation: current.source === 'workspace' ? 'UPDATE' : 'INSERT',
    before_data: current.rules,
    after_data: value,
    metadata: { version_from: current.version, version_to: value.version },
  })
  invalidateSchedulingRulesCache(workspaceId)
  return getWorkspaceSchedulingRules(db, workspaceId, { fresh: true })
}

/** Remove the override so the workspace falls back to the file defaults. */
export async function resetWorkspaceSchedulingRules(db, workspaceId, actor = {}) {
  const current = await getWorkspaceSchedulingRules(db, workspaceId, { fresh: true })
  const { error } = await db.from('workspace_scheduling_rules').delete().eq('workspace_id', workspaceId)
  if (error) throw new Error(error.message)
  await recordAudit(db, {
    workspace_id: workspaceId,
    actor_kind: actor.actor_kind || 'user',
    actor_id: actor.actor_id || null,
    actor_name: actor.actor_name || null,
    source_type: actor.source_type || 'web',
    object_type: 'scheduling_rules',
    entity_id: workspaceId,
    operation: 'DELETE',
    before_data: current.rules,
    after_data: getSchedulingRules(),
    metadata: { action: 'reset_to_defaults' },
  })
  invalidateSchedulingRulesCache(workspaceId)
  return getWorkspaceSchedulingRules(db, workspaceId, { fresh: true })
}

// ───────────────────────── calendar helpers ─────────────────────────
// All dates are YYYY-MM-DD on the Singapore calendar. Pure, so the bot, the
// reminder job and the observation panel agree to the day.

export function sgToday() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function assertMonth(value) {
  const s = String(value || '').trim()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(s)) throw new Error('month must be YYYY-MM')
  return s
}

export function addMonths(month, n) {
  const [y, m] = assertMonth(month).split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  return `${Math.floor(total / 12)}-${String((((total % 12) + 12) % 12) + 1).padStart(2, '0')}`
}

export function monthBounds(month) {
  const [y, m] = assertMonth(month).split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` }
}

function dayInMonth(month, day) {
  return `${month}-${String(day).padStart(2, '0')}`
}

/**
 * The availability window for a roster month per the rules:
 * opens on the prior month's open day, closes at the END of the prior
 * month's lock day (SGT), publish target on the prior month's target day.
 *
 * state (relative to `today`): 'upcoming' | 'open' | 'locked'
 */
export function availabilityWindowFor(rules, month, today = sgToday()) {
  const m = assertMonth(month)
  const prior = addMonths(m, -1)
  const av = rules.availability
  const openDate = dayInMonth(prior, av.open_day_of_prior_month)
  const lockDate = dayInMonth(prior, av.lock_day_of_prior_month)
  const publishTarget = dayInMonth(prior, rules.publish.target_day_of_prior_month)
  const { from, to } = monthBounds(m)
  let state = 'open'
  if (today < openDate) state = 'upcoming'
  else if (today > lockDate) state = 'locked'
  return {
    month: m,
    from,
    to,
    open_date: openDate,
    lock_date: lockDate,
    locked_from: addDays(lockDate, 1),
    publish_target_date: publishTarget,
    state,
    days_until_lock: state === 'locked' ? 0 : daysBetween(today, lockDate),
  }
}

export function daysBetween(a, b) {
  return Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86_400_000)
}

/** Is `date` (YYYY-MM-DD) still self-service-editable under the rules? */
export function isDateLockedByRules(rules, date, today = sgToday()) {
  const month = String(date).slice(0, 7)
  return availabilityWindowFor(rules, month, today).state === 'locked'
}

/**
 * The month whose availability window is currently the "live" one: the
 * nearest month whose window is open, else the next upcoming one.
 */
export function currentAvailabilityMonth(rules, today = sgToday()) {
  const thisMonth = today.slice(0, 7)
  for (let i = 1; i <= 3; i++) {
    const w = availabilityWindowFor(rules, addMonths(thisMonth, i), today)
    if (w.state !== 'locked') return w
  }
  return availabilityWindowFor(rules, addMonths(thisMonth, 1), today)
}

/**
 * Which reminders fire on `today`, per rules.availability.reminders.
 *   open   → on the open date
 *   T-nd   → n days before the lock date
 *   locked → the first locked day (lock date + 1)
 * Returns [{ kind, token, month, window }] — normally 0 or 1 entries, more
 * only if two tokens land on the same day.
 */
export function remindersDueOn(rules, today = sgToday()) {
  const due = []
  const thisMonth = today.slice(0, 7)
  for (let i = 0; i <= 2; i++) {
    const month = addMonths(thisMonth, i)
    const w = availabilityWindowFor(rules, month, today)
    for (const token of rules.availability.reminders || []) {
      const m = token.match(REMINDER_TOKEN)
      if (!m) continue
      let fireOn
      let kind
      if (token === 'open') { fireOn = w.open_date; kind = 'open' }
      else if (token === 'locked') { fireOn = w.locked_from; kind = 'locked' }
      else { fireOn = addDays(w.lock_date, -Number(m[2])); kind = 'countdown' }
      if (fireOn === today) due.push({ kind, token, month, window: w })
    }
  }
  return due
}
