// Roster change history — the readable side of the audit stream.
//
// Every roster/shift mutation already writes an append-only audit_events row
// (core/audit/record.mjs). This module reads those rows back for ONE roster and
// turns them into a plain-language, reverse-chronological timeline: who changed
// which shift, when, from what to what, and why. It is the accountability
// surface for adjustments and disputes, shared verbatim by the REST endpoint
// and the MCP tool so both tell the same story.
//
// Shift events are found by metadata.roster_id (stamped in the API layer), which
// is what lets a DELETED shift still appear — its audit row outlives the shift.

const SG = 'Asia/Singapore'

function sgTime(iso) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString('en-SG', {
      hour: '2-digit', minute: '2-digit', hour12: false, timeZone: SG,
    })
  } catch { return String(iso) }
}

/** A shift audit row's before/after both carry the full shift; describe one side. */
function describeShift(row, nameOf) {
  if (!row) return 'a shift'
  const who = row.staff_id ? nameOf(row.staff_id) : 'Open shift'
  const when = row.work_date || ''
  const span = row.start_at ? ` ${sgTime(row.start_at)}–${sgTime(row.end_at)}` : ''
  return `${who} · ${when}${span}`.trim()
}

/** Field-by-field diff of a shift UPDATE, in human terms. */
function shiftChanges(before, after, nameOf) {
  const changes = []
  const push = (field, from, to) => { if (String(from) !== String(to)) changes.push({ field, from, to }) }

  if ((before?.staff_id || null) !== (after?.staff_id || null)) {
    changes.push({
      field: 'assignment',
      from: before?.staff_id ? nameOf(before.staff_id) : 'Open shift',
      to: after?.staff_id ? nameOf(after.staff_id) : 'Open shift',
    })
  }
  if (before?.start_at !== after?.start_at) push('start', sgTime(before?.start_at), sgTime(after?.start_at))
  if (before?.end_at !== after?.end_at) push('end', sgTime(before?.end_at), sgTime(after?.end_at))
  push('break (min)', before?.break_minutes ?? 0, after?.break_minutes ?? 0)
  push('job code', before?.job_code || '—', after?.job_code || '—')
  push('status', before?.status || '—', after?.status || '—')
  push('date', before?.work_date || '—', after?.work_date || '—')
  return changes
}

function summarise(ev, nameOf) {
  const meta = ev.metadata || {}
  if (ev.object_type === 'shifts') {
    if (ev.operation === 'INSERT') return `Added shift — ${describeShift(ev.after_data, nameOf)}`
    if (ev.operation === 'DELETE') return `Removed shift — ${describeShift(ev.before_data, nameOf)}`
    const changes = shiftChanges(ev.before_data, ev.after_data, nameOf)
    const subject = describeShift(ev.after_data || ev.before_data, nameOf)
    if (!changes.length) return `Edited shift — ${subject}`
    return `Edited shift — ${subject}: ${changes.map((c) => `${c.field} ${c.from}→${c.to}`).join(', ')}`
  }
  if (ev.object_type === 'rosters') {
    if (meta.action === 'apply_roster_run') return `Created draft from a proposal (${meta.created ?? '?'} shift(s))`
    if (meta.action === 'publish') {
      const v = ev.after_data?.version
      const republish = (ev.before_data?.status === 'published')
      const accepted = meta.warnings_accepted ? `, ${meta.warnings_accepted} warning(s) accepted` : ''
      return `${republish ? `Republished as v${v}` : 'Published'}${accepted}`
    }
    return `Roster ${ev.operation.toLowerCase()}`
  }
  if (ev.object_type === 'roster_runs') {
    if (meta.action === 'generate_roster_proposal') {
      return `Generated a proposal (${meta.filled ?? '?'} filled, ${meta.unfilled ?? 0} unfilled)`
    }
    return 'Roster proposal'
  }
  if (ev.object_type === 'roster_import_batches') return `Imported a spreadsheet (${meta.imported ?? '?'} shift(s))`
  return `${ev.object_type} ${ev.operation.toLowerCase()}`
}

/**
 * The full change history for one roster, newest first.
 * @param {object} db service-role Supabase client
 * @param {string} workspaceId
 * @param {object} roster { id, store_id, week_start, status, version }
 * @param {{ limit?: number }} [opts]
 * @returns {Promise<{ roster: object, events: Array, total: number }>}
 */
export async function rosterHistory(db, workspaceId, roster, { limit = 300 } = {}) {
  // Runs (generated/imported) tied to this roster, so their origin shows too.
  const { data: runs } = await db.from('roster_runs')
    .select('id').eq('workspace_id', workspaceId).eq('roster_id', roster.id)
  const rosterScopedIds = [roster.id, ...(runs || []).map((r) => r.id)]

  const [shiftEvsRes, rosterEvsRes] = await Promise.all([
    // Shift events for this week — found by the stamped roster_id, so deleted
    // shifts are still accounted for.
    db.from('audit_events')
      .select('id, actor_kind, actor_name, source_type, object_type, entity_id, operation, before_data, after_data, metadata, created_at')
      .eq('workspace_id', workspaceId).eq('object_type', 'shifts')
      .eq('metadata->>roster_id', roster.id)
      .order('created_at', { ascending: false }).limit(limit),
    // Roster-level + proposal events.
    db.from('audit_events')
      .select('id, actor_kind, actor_name, source_type, object_type, entity_id, operation, before_data, after_data, metadata, created_at')
      .eq('workspace_id', workspaceId).in('object_type', ['rosters', 'roster_runs'])
      .in('entity_id', rosterScopedIds)
      .order('created_at', { ascending: false }).limit(limit),
  ])
  if (shiftEvsRes.error) throw new Error(shiftEvsRes.error.message)
  if (rosterEvsRes.error) throw new Error(rosterEvsRes.error.message)

  const raw = [...(shiftEvsRes.data || []), ...(rosterEvsRes.data || [])]

  // Resolve staff ids that appear in any event to display names, in one query.
  const ids = new Set()
  for (const ev of raw) {
    for (const side of [ev.before_data, ev.after_data]) {
      if (side?.staff_id) ids.add(side.staff_id)
    }
  }
  const nameMap = new Map()
  if (ids.size) {
    const { data: staff } = await db.from('staff')
      .select('id, display_name, employee_code').eq('workspace_id', workspaceId).in('id', [...ids])
    for (const s of staff || []) nameMap.set(s.id, s.display_name || s.employee_code)
  }
  const nameOf = (id) => nameMap.get(id) || 'a staff member'

  const events = raw
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, limit)
    .map((ev) => ({
      id: ev.id,
      at: ev.created_at,
      actor_name: ev.actor_name || (ev.actor_kind === 'agent' ? 'Claude (agent)' : 'System'),
      actor_kind: ev.actor_kind,
      source: ev.source_type,
      object_type: ev.object_type,
      operation: ev.operation,
      reason: ev.metadata?.reason || null,
      summary: summarise(ev, nameOf),
      changes: ev.object_type === 'shifts' && ev.operation === 'UPDATE'
        ? shiftChanges(ev.before_data, ev.after_data, nameOf)
        : [],
    }))

  return {
    roster: {
      id: roster.id, store_id: roster.store_id, week_start: roster.week_start,
      status: roster.status, version: roster.version,
    },
    events,
    total: events.length,
  }
}
