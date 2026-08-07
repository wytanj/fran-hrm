// Roster intake service: the DB-bound half of generation and import.
//
// Shared by the REST routes and the MCP tools so an agent and the web app take
// exactly the same path — including the same guardrails and the same refusal to
// write anything but a draft.

import { validateConstraints, explainConstraints } from './constraints.mjs'
import { generateRoster } from './generate.mjs'
import { formatRoster } from './export.mjs'
import { rosterGuardrails } from './query.mjs'
import { parseSheet } from '../import/parse.mjs'
import { suggestMapping, validateMapping, toColumnView } from '../import/map.mjs'
import { normaliseRosterRows } from '../import/roster.mjs'

const DAY = 86400_000
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const mondayOf = (date) => {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}

/** Everything a generator or importer needs about the workspace. */
export async function loadPlanningContext(db, workspaceId, { storeId, weekStart } = {}) {
  const weekEnd = weekStart ? addDays(weekStart, 6) : null

  const [staffRes, templatesRes, storesRes] = await Promise.all([
    db.from('staff')
      .select('id, employee_code, display_name, comms_title, role, employment_type, employment_status, pt_weekly_hour_cap, home_store_id, position:position_id(title, comms_title)')
      .eq('workspace_id', workspaceId).eq('employment_status', 'active').order('employee_code'),
    db.from('shift_templates')
      .select('id, name, start_time, end_time, break_minutes, job_code, store_id')
      .eq('workspace_id', workspaceId).eq('is_active', true).order('start_time'),
    db.from('stores').select('id, code, name, kind').eq('workspace_id', workspaceId),
  ])
  if (staffRes.error) throw new Error(staffRes.error.message)

  let staff = staffRes.data || []
  // Prefer people attached to this store, but keep everyone else available as
  // cross-store cover rather than silently excluding them.
  if (storeId) {
    const { data: assignments } = await db.from('staff_store_assignments')
      .select('staff_id').eq('workspace_id', workspaceId).eq('store_id', storeId)
    const assigned = new Set((assignments || []).map((a) => a.staff_id))
    staff = staff.filter((s) => s.home_store_id === storeId || assigned.has(s.id) || !s.home_store_id)
  }

  let availability = []
  let leave = []
  let priorShifts = []
  if (weekStart) {
    const [availRes, leaveRes, priorRes] = await Promise.all([
      db.from('availability').select('staff_id, work_date, kind, start_time, end_time')
        .eq('workspace_id', workspaceId).gte('work_date', weekStart).lte('work_date', weekEnd),
      db.from('leave_requests').select('staff_id, start_date, end_date, status')
        .eq('workspace_id', workspaceId).in('status', ['approved', 'pending'])
        .lte('start_date', weekEnd).gte('end_date', weekStart),
      db.from('shifts').select('staff_id, work_date, start_at, end_at')
        .eq('workspace_id', workspaceId).neq('status', 'cancelled')
        .gte('work_date', addDays(weekStart, -7)).lt('work_date', weekStart),
    ])
    availability = availRes.data || []
    leave = leaveRes.data || []
    priorShifts = priorRes.data || []
  }

  return { staff, templates: templatesRes.data || [], stores: storesRes.data || [], availability, leave, priorShifts }
}

/**
 * Generate a proposal and persist it as a roster_run. Writes NO shifts.
 * @returns {{ run, proposal, unmet, warnings, summary, table }}
 */
export async function generateProposal(db, workspaceId, {
  storeId, weekStart, constraints, constraintSetId, actor = {},
}) {
  const week = mondayOf(weekStart)
  const ctx = await loadPlanningContext(db, workspaceId, { storeId, weekStart: week })

  const validated = validateConstraints(constraints, { templates: ctx.templates })
  if (!validated.ok) {
    const err = new Error(`Constraints are not usable:\n- ${validated.errors.join('\n- ')}`)
    err.validation = validated
    throw err
  }

  const result = generateRoster({
    constraints: validated.constraints,
    weekStart: week,
    staff: ctx.staff,
    availability: ctx.availability,
    leave: ctx.leave,
    priorShifts: ctx.priorShifts,
  })

  const store = ctx.stores.find((s) => s.id === storeId)
  const { data: run, error } = await db.from('roster_runs').insert({
    workspace_id: workspaceId,
    store_id: storeId,
    week_start: week,
    source: 'generated',
    status: 'proposed',
    constraint_set_id: constraintSetId || null,
    constraints_used: validated.constraints,
    proposal: result.shifts,
    unmet: result.unmet,
    warnings: [...validated.warnings, ...result.warnings],
    generated_by_kind: actor.kind === 'agent' ? 'agent' : 'user',
    generated_by: actor.staffId || null,
    generator: actor.name || null,
  }).select().single()
  if (error) throw new Error(error.message)

  return {
    run_id: run.id,
    week_start: week,
    store: store ? { id: store.id, code: store.code, name: store.name } : null,
    summary: result.summary,
    unmet: result.unmet,
    warnings: [...validated.warnings, ...result.warnings],
    constraints_explained: explainConstraints(validated.constraints),
    table: formatRoster(result.shifts, { format: 'grid', weekStart: week, storeName: store?.name }),
    proposal: result.shifts,
  }
}

/**
 * Turn a proposed run into a DRAFT roster with real shifts.
 * Idempotent per run: applying twice returns the same roster.
 */
export async function applyRun(db, workspaceId, runId, { actor = {}, replace = false } = {}) {
  const { data: run, error } = await db.from('roster_runs')
    .select('*').eq('workspace_id', workspaceId).eq('id', runId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!run) throw new Error(`Roster run ${runId} not found`)
  if (run.status === 'applied' && run.roster_id) {
    return { roster_id: run.roster_id, already_applied: true, applied_at: run.applied_at, created: 0 }
  }

  const shifts = Array.isArray(run.proposal) ? run.proposal : []
  if (!shifts.length) throw new Error('This run has no proposed shifts to apply.')

  // Get or create the draft roster for the week.
  let { data: roster } = await db.from('rosters').select('*')
    .eq('workspace_id', workspaceId).eq('store_id', run.store_id).eq('week_start', run.week_start).maybeSingle()

  if (roster && roster.status === 'published' && !replace) {
    throw new Error(`The roster for ${run.week_start} is already PUBLISHED. Pass replace=true to overwrite its shifts (it stays published and the version bumps on republish), or pick another week.`)
  }
  if (!roster) {
    const ins = await db.from('rosters').insert({
      workspace_id: workspaceId, store_id: run.store_id, week_start: run.week_start,
      notes: run.source === 'imported' ? 'Imported from spreadsheet' : 'Generated from constraints',
    }).select().single()
    if (ins.error) throw new Error(ins.error.message)
    roster = ins.data
  } else if (replace) {
    await db.from('shifts').delete().eq('roster_id', roster.id)
  }

  const rows = shifts.map((sh) => ({
    workspace_id: workspaceId,
    roster_id: roster.id,
    store_id: sh.store_id || run.store_id,
    staff_id: sh.staff_id || null,
    work_date: sh.work_date,
    start_at: sh.start_at,
    end_at: sh.end_at,
    break_minutes: sh.break_minutes || 0,
    job_code: sh.job_code || null,
    template_id: sh.template_id || null,
    notes: sh.notes || null,
  }))

  // Bulk insert, then fall back to row-by-row so one bad shift does not lose
  // the other 40 — and so the failure names the row that caused it.
  const rowErrors = []
  let created = []
  const bulk = await db.from('shifts').insert(rows).select('id')
  if (bulk.error) {
    for (const row of rows) {
      const one = await db.from('shifts').insert(row).select('id').maybeSingle()
      if (one.error) {
        rowErrors.push({
          work_date: row.work_date,
          staff_id: row.staff_id,
          error: one.error.message,
        })
      } else if (one.data) created.push(one.data)
    }
  } else {
    created = bulk.data || []
  }
  if (!created.length) {
    throw new Error(`No shifts could be created. First error: ${rowErrors[0]?.error || bulk.error?.message || 'unknown'}`)
  }

  await db.from('roster_runs').update({
    status: 'applied', roster_id: roster.id, applied_at: new Date().toISOString(),
  }).eq('id', run.id)

  // Run the same guardrails the publish step will.
  const { data: allShifts } = await db.from('shifts').select('*').eq('roster_id', roster.id).neq('status', 'cancelled')
  const { data: ws } = await db.from('workspaces').select('settings').eq('id', workspaceId).maybeSingle()
  const warnings = await rosterGuardrails(db, workspaceId, roster, allShifts || [], ws?.settings || {})

  return {
    roster_id: roster.id,
    week_start: run.week_start,
    status: roster.status,
    created: created.length,
    failed: rowErrors.length,
    row_errors: rowErrors.slice(0, 20),
    guardrail_warnings: warnings,
    note: `Created a ${roster.status} roster with ${created.length} shift(s)${rowErrors.length ? `, ${rowErrors.length} failed` : ''}. Staff will not see it until it is published.`,
  }
}

/**
 * Import step 1: parse a sheet, guess the mapping, and stage a preview batch.
 * If a mapping is supplied (or a saved one is named) the preview is produced
 * in the same call, so the happy path is one round trip.
 */
export async function importPreview(db, workspaceId, {
  text, storeId, weekStart, mapping, layout, valueAliases, mappingId, sourceName, actor = {},
}) {
  const parsed = parseSheet(text)
  if (!parsed.headers.length) throw new Error('Could not find a header row in that sheet.')

  let saved = null
  if (mappingId) {
    const { data } = await db.from('roster_import_mappings')
      .select('*').eq('workspace_id', workspaceId).eq('id', mappingId).maybeSingle()
    saved = data
  }

  const suggestion = suggestMapping(parsed.headers, { layout: layout || saved?.layout })
  const effectiveLayout = layout || saved?.layout || suggestion.layout
  const effectiveMapping = mapping || saved?.mapping || suggestion.mapping
  const aliases = valueAliases || saved?.value_aliases || {}

  const check = validateMapping(effectiveMapping, parsed.headers, effectiveLayout)
  const ctx = await loadPlanningContext(db, workspaceId, { storeId })

  let normalised = { shifts: [], errors: [], stats: null }
  if (check.ok) {
    normalised = normaliseRosterRows({
      rows: parsed.rows,
      mapping: check.mapping,
      layout: effectiveLayout,
      dateColumns: suggestion.date_columns,
      staff: ctx.staff,
      templates: ctx.templates,
      stores: ctx.stores,
      valueAliases: aliases,
      defaultStoreId: storeId || null,
      contextYear: weekStart ? Number(String(weekStart).slice(0, 4)) : undefined,
    })
  }

  const dates = normalised.shifts.map((s) => s.work_date).sort()
  const inferredWeek = weekStart ? mondayOf(weekStart) : (dates.length ? mondayOf(dates[0]) : null)

  const { data: batch, error } = await db.from('roster_import_batches').insert({
    workspace_id: workspaceId,
    store_id: storeId || null,
    week_start: inferredWeek,
    mapping_id: mappingId || null,
    mapping_used: check.mapping,
    layout: effectiveLayout,
    source_name: sourceName || null,
    headers: parsed.headers,
    row_count: parsed.rows.length,
    preview: normalised.shifts.slice(0, 500),
    errors: normalised.errors.slice(0, 200),
    status: 'preview',
    created_by: actor.staffId || null,
  }).select().single()
  if (error) throw new Error(error.message)

  // Weeks touched, so a multi-week sheet is obvious before committing.
  const weeks = [...new Set(normalised.shifts.map((s) => mondayOf(s.work_date)))].sort()

  return {
    batch_id: batch.id,
    ready: check.ok && normalised.shifts.length > 0,
    layout: effectiveLayout,
    layout_detection: suggestion.layout_detection,
    headers: parsed.headers,
    header_row: parsed.headerIndex + 1,
    mapping: check.mapping,
    // One entry per spreadsheet column — what the confirmation screen renders.
    columns: toColumnView(parsed.headers, check.mapping, {
      dateColumns: suggestion.date_columns, suggestions: suggestion.suggestions,
    }),
    mapping_suggestions: suggestion.suggestions,
    unmapped_headers: suggestion.unmapped_headers,
    mapping_errors: check.errors,
    missing_required: suggestion.missing_required,
    date_columns: suggestion.date_columns,
    stats: normalised.stats,
    weeks_touched: weeks,
    week_start: inferredWeek,
    sample: normalised.shifts.slice(0, 10),
    errors: normalised.errors.slice(0, 25),
    note: !check.ok
      ? 'Mapping is incomplete — fix the mapping and preview again.'
      : normalised.shifts.length
        ? `Ready: ${normalised.shifts.length} shift(s) across ${weeks.length} week(s).${normalised.errors.length ? ` ${normalised.errors.length} row(s) had problems and will be skipped.` : ''} Commit with the batch_id.`
        : 'No shifts could be read. Check the mapping and the error list.',
  }
}

/** Import step 2: commit a previewed batch into a draft roster. */
export async function importCommit(db, workspaceId, batchId, { actor = {}, replace = false, saveMappingAs } = {}) {
  const { data: batch, error } = await db.from('roster_import_batches')
    .select('*').eq('workspace_id', workspaceId).eq('id', batchId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!batch) throw new Error(`Import batch ${batchId} not found`)
  if (batch.status === 'committed') {
    return { already_committed: true, roster_id: batch.roster_id, imported: batch.imported_count }
  }

  const shifts = Array.isArray(batch.preview) ? batch.preview : []
  if (!shifts.length) throw new Error('This batch has no importable shifts. Re-run the preview with a corrected mapping.')

  // A sheet can span weeks; each becomes its own draft roster via a run.
  const byWeek = new Map()
  for (const sh of shifts) {
    const wk = mondayOf(sh.work_date)
    byWeek.set(wk, [...(byWeek.get(wk) || []), sh])
  }

  const results = []
  for (const [week, weekShifts] of byWeek) {
    const storeId = batch.store_id || weekShifts[0]?.store_id
    const { data: run, error: runErr } = await db.from('roster_runs').insert({
      workspace_id: workspaceId,
      store_id: storeId,
      week_start: week,
      source: 'imported',
      status: 'proposed',
      constraints_used: {},
      proposal: weekShifts,
      unmet: [],
      warnings: [],
      generated_by_kind: actor.kind === 'agent' ? 'agent' : 'user',
      generated_by: actor.staffId || null,
      generator: batch.source_name || actor.name || null,
    }).select().single()
    if (runErr) throw new Error(runErr.message)
    results.push(await applyRun(db, workspaceId, run.id, { actor, replace }))
  }

  await db.from('roster_import_batches').update({
    status: 'committed',
    roster_id: results[0]?.roster_id || null,
    imported_count: shifts.length,
    committed_at: new Date().toISOString(),
  }).eq('id', batch.id)

  if (saveMappingAs) {
    await db.from('roster_import_mappings').upsert({
      workspace_id: workspaceId,
      store_id: batch.store_id,
      name: saveMappingAs,
      mapping: batch.mapping_used,
      layout: batch.layout,
      last_used_at: new Date().toISOString(),
      created_by: actor.staffId || null,
    }, { onConflict: 'workspace_id,name' })
  }

  return {
    imported: shifts.length,
    skipped: (batch.errors || []).length,
    rosters: results,
    note: `Imported ${shifts.length} shift(s) into ${results.length} draft roster(s). Review and publish when ready.`,
  }
}
