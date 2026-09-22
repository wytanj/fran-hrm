// Singapore statutory helpers — timeline lookup + CPF/SHG/SDL *preview*.
//
// Rates come from sg_statutory_timeline (append-only). Built-in FALLBACKS are
// illustrative only for UI/MCP previews when finance has not seeded the
// timeline yet — they are labelled `rate_source: 'fallback'` and must not be
// treated as Board-official for live payroll file generation.
//
// Never UPDATE timeline history from this module. Use appendStatutoryRate().

import { getPayrollSettings } from './settings.mjs'

/** @typedef {'cpf_band'|'ow_ceiling'|'aw_ceiling'|'shg_rate'|'sdl_rate'|'ot_multiplier'|'note'} StatutoryKind */

export const SHG_BY_RACE = {
  chinese: 'CDAC',
  malay: 'MBMF',
  indian: 'SINDA',
  eurasian: 'ECF',
}

/** Fallback CPF employee/employer % by age band (citizen / PR Y3+), for preview only. */
export const FALLBACK_CPF_BANDS = [
  { key: 'age_55_below', age_min: 0, age_max: 55, employee_pct: 20, employer_pct: 17 },
  { key: 'age_55_60', age_min: 55, age_max: 60, employee_pct: 13, employer_pct: 14.5 },
  { key: 'age_60_65', age_min: 60, age_max: 65, employee_pct: 7.5, employer_pct: 11 },
  { key: 'age_65_plus', age_min: 65, age_max: 200, employee_pct: 5, employer_pct: 9 },
]

export const FALLBACK_OW_CEILING_CENTS = 740_000 // preview placeholder
export const FALLBACK_AW_CEILING_CENTS = 10_200_000
export const FALLBACK_OT_MULTIPLIER = 1.5
export const FALLBACK_SDL_PCT = 0.25 // of total wages, preview

function ageOn(dateStr, dob) {
  if (!dob) return null
  const at = new Date(`${dateStr}T00:00:00Z`)
  const born = new Date(`${String(dob).slice(0, 10)}T00:00:00Z`)
  let age = at.getUTCFullYear() - born.getUTCFullYear()
  const m = at.getUTCMonth() - born.getUTCMonth()
  if (m < 0 || (m === 0 && at.getUTCDate() < born.getUTCDate())) age -= 1
  return age
}

function prYearsOn(dateStr, prStart) {
  if (!prStart) return null
  const ms = new Date(`${dateStr}T00:00:00Z`) - new Date(`${String(prStart).slice(0, 10)}T00:00:00Z`)
  return ms / (365.25 * 86400_000)
}

/**
 * Resolve the rate row in force on `onDate` for (kind, key).
 * Prefers the latest effective_from ≤ onDate with open/covering effective_to.
 */
export async function lookupStatutoryRate(db, workspaceId, { kind, key, onDate }) {
  if (!kind || !key || !onDate) throw new Error('kind, key and onDate are required')
  const { data, error } = await db
    .from('sg_statutory_timeline')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('kind', kind)
    .eq('key', key)
    .lte('effective_from', onDate)
    .order('effective_from', { ascending: false })
    .limit(20)
  if (error) throw new Error(error.message)
  const row = (data || []).find((r) => !r.effective_to || r.effective_to > onDate)
  return row || null
}

/** List timeline rows (newest first). Read-only history for CoS / finance. */
export async function listStatutoryTimeline(db, workspaceId, { kind, key, limit = 100 } = {}) {
  let q = db
    .from('sg_statutory_timeline')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('effective_from', { ascending: false })
    .limit(Math.min(Number(limit) || 100, 500))
  if (kind) q = q.eq('kind', kind)
  if (key) q = q.eq('key', key)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return data || []
}

/**
 * APPEND a new rate. Refuses to update existing rows.
 * Optionally close the previous open-ended row by setting effective_to = effective_from
 * of the new row (still an UPDATE of the prior row's end bound only — never mutates payload).
 */
export async function appendStatutoryRate(db, workspaceId, row, { actorStaffId = null, closePrevious = true } = {}) {
  const kind = String(row.kind || '')
  const key = String(row.key || '')
  const effectiveFrom = String(row.effective_from || '').slice(0, 10)
  if (!kind || !key || !/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
    throw new Error('kind, key and effective_from (YYYY-MM-DD) are required')
  }
  if (closePrevious) {
    const prev = await lookupStatutoryRate(db, workspaceId, { kind, key, onDate: effectiveFrom })
    if (prev && !prev.effective_to && prev.effective_from < effectiveFrom) {
      const { error: uerr } = await db
        .from('sg_statutory_timeline')
        .update({ effective_to: effectiveFrom })
        .eq('id', prev.id)
        .is('effective_to', null)
      if (uerr) throw new Error(uerr.message)
    }
  }
  const { data, error } = await db
    .from('sg_statutory_timeline')
    .insert({
      workspace_id: workspaceId,
      kind,
      key,
      effective_from: effectiveFrom,
      effective_to: row.effective_to || null,
      payload: row.payload || {},
      source: row.source || null,
      notes: row.notes || null,
      created_by: actorStaffId,
    })
    .select()
    .single()
  if (error) throw new Error(error.message)
  return data
}

/** Which SHG agency applies for this staff (null if opted out / none). */
/**
 * Resolve SHG employee contribution from payload.bands by wage (OW cents).
 * Accepted band shapes (first match wins; keep bands ordered low→high):
 *   { min_cents, max_cents?, employee_cents }
 *   { from_cents, to_cents?, amount_cents }
 *   { min, max?, amount }  // amount in dollars when not *_cents
 * max/to exclusive when present; omit max for open-ended top band.
 * Returns null when bands missing/empty or wage matches none.
 */
export function resolveShgBandCents(bands, wageCents) {
  if (!Array.isArray(bands) || bands.length === 0) return null
  const wage = Math.max(0, Math.round(Number(wageCents) || 0))
  for (const raw of bands) {
    if (!raw || typeof raw !== "object") continue
    const min = Number(raw.min_cents ?? raw.from_cents ?? raw.min ?? 0)
    const maxRaw = raw.max_cents ?? raw.to_cents ?? raw.max
    const max = maxRaw == null || maxRaw === "" ? Number.POSITIVE_INFINITY : Number(maxRaw)
    let amt = raw.employee_cents ?? raw.amount_cents ?? raw.amount ?? raw.cents
    if (amt == null) continue
    amt = Number(amt)
    if (raw.employee_cents == null && raw.amount_cents == null && raw.cents == null && raw.amount != null && amt > 0 && amt < 1000) {
      amt = Math.round(amt * 100)
    } else {
      amt = Math.round(amt)
    }
    if (!(wage >= min && wage < max)) continue
    return amt
  }
  return null
}

export function resolveShgAgency(staff) {
  if (staff?.shg_opt_out) return null
  const religion = String(staff?.religion || '').toLowerCase()
  if (religion === 'muslim' || religion === 'islam') return 'MBMF'
  const race = String(staff?.race || '').toLowerCase()
  return SHG_BY_RACE[race] || null
}

/**
 * Preview CPF + SHG + SDL for a wage split on a given date.
 * Returns cents integers; labels rate_source as 'timeline' | 'settings' | 'fallback'.
 */
export async function previewStatutory(db, workspaceId, {
  staff,
  onDate,
  ordinaryWagesCents = 0,
  additionalWagesCents = 0,
}) {
  const settings = await getPayrollSettings(db, workspaceId)
  const owCeilingRow = await lookupStatutoryRate(db, workspaceId, { kind: 'ow_ceiling', key: 'default', onDate })
  const awCeilingRow = await lookupStatutoryRate(db, workspaceId, { kind: 'aw_ceiling', key: 'default', onDate })

  const owCeiling = Number(owCeilingRow?.payload?.cents)
    || Number(settings.settings?.cpf?.ordinary_wage_ceiling_cents)
    || FALLBACK_OW_CEILING_CENTS
  const awCeiling = Number(awCeilingRow?.payload?.cents)
    || Number(settings.settings?.cpf?.additional_wage_ceiling_cents)
    || FALLBACK_AW_CEILING_CENTS

  const ow = Math.min(Math.max(0, Math.round(ordinaryWagesCents)), owCeiling)
  const aw = Math.min(Math.max(0, Math.round(additionalWagesCents)), awCeiling)
  const total = ow + aw

  const applicable = staff?.cpf_applicable !== false
    && staff?.residency !== 'foreigner'
  const age = ageOn(onDate, staff?.date_of_birth)
  const prYrs = staff?.residency === 'pr' ? prYearsOn(onDate, staff?.pr_start_date) : null

  let employeePct = 0
  let employerPct = 0
  let rateSource = 'fallback'
  let bandKey = null

  if (!applicable || total <= 50_00) {
    // Below CPF threshold or not applicable — zero contributions.
    rateSource = 'n/a'
  } else {
    // Prefer timeline band matching age (+ optional PR year).
    const bands = await listStatutoryTimeline(db, workspaceId, { kind: 'cpf_band', limit: 50 })
    const inForce = bands.filter((b) => b.effective_from <= onDate && (!b.effective_to || b.effective_to > onDate))
    const match = inForce.find((b) => {
      const p = b.payload || {}
      if (age != null && p.age_min != null && age < p.age_min) return false
      if (age != null && p.age_max != null && age >= p.age_max) return false
      if (p.pr_year_min != null && (prYrs == null || prYrs < p.pr_year_min)) return false
      if (p.pr_year_max != null && (prYrs == null || prYrs >= p.pr_year_max)) return false
      if (p.pr_cpf_type && staff?.pr_cpf_type && p.pr_cpf_type !== staff.pr_cpf_type) return false
      return true
    })
    if (match) {
      employeePct = Number(match.payload?.employee_pct) || 0
      employerPct = Number(match.payload?.employer_pct) || 0
      bandKey = match.key
      rateSource = 'timeline'
    } else {
      const configured = Array.isArray(settings.settings?.cpf?.bands) ? settings.settings.cpf.bands : []
      const cfg = configured.find((b) => {
        if (age == null) return false
        return age >= (b.age_min ?? 0) && age < (b.age_max ?? 200)
      })
      if (cfg) {
        employeePct = Number(cfg.employee_pct) || 0
        employerPct = Number(cfg.employer_pct) || 0
        bandKey = cfg.label || cfg.key || null
        rateSource = 'settings'
      } else {
        const fb = FALLBACK_CPF_BANDS.find((b) => age != null && age >= b.age_min && age < b.age_max)
          || FALLBACK_CPF_BANDS[0]
        employeePct = fb.employee_pct
        employerPct = fb.employer_pct
        bandKey = fb.key
        rateSource = 'fallback'
      }
    }
  }

  const cpfEmployee = Math.round(total * employeePct / 100)
  const cpfEmployer = Math.round(total * employerPct / 100)

  const shgAgency = resolveShgAgency(staff)
  let shgCents = 0
  let shgSource = 'n/a'
  if (shgAgency) {
    const shgRow = await lookupStatutoryRate(db, workspaceId, {
      kind: 'shg_rate', key: shgAgency.toLowerCase(), onDate,
    })
        if (shgRow?.payload?.employee_cents != null) {
      shgCents = Math.round(Number(shgRow.payload.employee_cents))
      shgSource = 'timeline'
    } else if (shgRow?.payload?.pct_of_ow != null) {
      shgCents = Math.round(ow * Number(shgRow.payload.pct_of_ow) / 100)
      shgSource = 'timeline'
    } else if (Array.isArray(shgRow?.payload?.bands) && shgRow.payload.bands.length) {
      const banded = resolveShgBandCents(shgRow.payload.bands, ow)
      if (banded != null) {
        shgCents = banded
        shgSource = 'timeline'
      } else {
        shgCents = 0
        shgSource = 'unconfigured'
      }
    } else {
      // Preview stub: $0 until finance seeds employee_cents / pct_of_ow / bands.
      shgCents = 0
      shgSource = 'unconfigured'
    }
  }

  const sdlRow = await lookupStatutoryRate(db, workspaceId, { kind: 'sdl_rate', key: 'default', onDate })
  const sdlPct = Number(sdlRow?.payload?.pct) || FALLBACK_SDL_PCT
  const sdlMin = Number(sdlRow?.payload?.min_cents) || 0
  const sdlMax = Number(sdlRow?.payload?.max_cents) || Number.POSITIVE_INFINITY
  let sdlCents = Math.round(total * sdlPct / 100)
  sdlCents = Math.min(Math.max(sdlCents, sdlMin), sdlMax)

  return {
    on_date: onDate,
    staff_id: staff?.id || null,
    residency: staff?.residency || null,
    age_years: age,
    pr_years: prYrs,
    pr_cpf_type: staff?.pr_cpf_type || null,
    cpf_applicable: applicable,
    ordinary_wages_cents: ow,
    additional_wages_cents: aw,
    ow_ceiling_cents: owCeiling,
    aw_ceiling_cents: awCeiling,
    cpf: {
      band_key: bandKey,
      employee_pct: employeePct,
      employer_pct: employerPct,
      employee_cents: cpfEmployee,
      employer_cents: cpfEmployer,
      rate_source: rateSource,
    },
    shg: {
      agency: shgAgency,
      employee_cents: shgCents,
      rate_source: shgSource,
      opt_out: !!staff?.shg_opt_out,
    },
    sdl: {
      cents: sdlCents,
      pct: sdlPct,
      rate_source: sdlRow ? 'timeline' : 'fallback',
    },
    disclaimer:
      'Preview only. Timeline/fallback rates are for staff estimate + fran-bird — not a substitute for Board-calculated CPF ezPay amounts.',
  }
}

export async function resolveOtMultiplier(db, workspaceId, onDate) {
  const row = await lookupStatutoryRate(db, workspaceId, { kind: 'ot_multiplier', key: 'default', onDate })
  const m = Number(row?.payload?.multiplier)
  return {
    multiplier: Number.isFinite(m) && m > 0 ? m : FALLBACK_OT_MULTIPLIER,
    rate_source: row ? 'timeline' : 'fallback',
  }
}
