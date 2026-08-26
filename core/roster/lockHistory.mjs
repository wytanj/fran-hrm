// Week-by-week availability lock/unlock log, read from audit_events.
//
// Filter is by locked dates (after_data.dates overlapping [from, to]), not
// by audit_events.created_at. A manager looking at 24–30 Aug wants to know
// who froze those dates — even if they clicked Lock the week before.

import { datesOverlapRange, summariseLockEvent } from './lockCopy.mjs'

const EVENT_COLS = 'id, actor_kind, actor_name, source_type, entity_id, operation, after_data, metadata, created_at'

/**
 * Shape one audit row + resolved staff into the history list item.
 * Exported for tests; listAvailabilityLockEvents is the production entry.
 */
export function presentLockEvents(raw, staffRows, { storeId, from, to } = {}) {
  const staffMap = new Map((staffRows || []).map((s) => [s.id, s]))
  const events = []
  for (const ev of raw || []) {
    const dates = Array.isArray(ev.after_data?.dates) ? ev.after_data.dates : []
    if (!datesOverlapRange(dates, from, to)) continue
    const s = staffMap.get(ev.entity_id)
    if (storeId && s?.home_store_id !== storeId) continue
    const actorName = ev.actor_name || (ev.actor_kind === 'agent' ? 'Claude (agent)' : 'Someone')
    events.push({
      id: ev.id,
      at: ev.created_at,
      operation: ev.operation,
      staff: s
        ? { name: s.display_name, code: s.employee_code }
        : { name: 'Unknown staff', code: null },
      actor_name: actorName,
      dates,
      reason: ev.metadata?.reason || null,
      summary: summariseLockEvent({
        operation: ev.operation,
        staffName: s?.display_name,
        dates,
        actorName,
      }),
      source: ev.source_type || 'web',
    })
  }
  events.sort((a, b) => String(b.at).localeCompare(String(a.at)))
  return events
}

/**
 * @param {object} db service-role Supabase client
 * @param {string} workspaceId
 * @param {{ storeId?: string, from: string, to: string, limit?: number }} opts
 */
export async function listAvailabilityLockEvents(db, workspaceId, { storeId, from, to, limit = 200 } = {}) {
  if (!from || !to) throw new Error('from and to are required')
  const cap = Math.min(Math.max(Number(limit) || 200, 1), 500)

  // Newest 2000 lock events in the workspace, then overlap-filter in JS.
  // Two stores / a handful of staff will not approach that; a SQL overlap
  // on jsonb dates can replace this if it ever does.
  const { data, error } = await db
    .from('audit_events')
    .select(EVENT_COLS)
    .eq('workspace_id', workspaceId)
    .eq('object_type', 'availability_lock')
    .order('created_at', { ascending: false })
    .limit(2000)
  if (error) throw new Error(error.message)

  const raw = data || []
  const staffIds = [...new Set(raw.map((e) => e.entity_id).filter(Boolean))]
  let staffRows = []
  if (staffIds.length) {
    const staffRes = await db
      .from('staff')
      .select('id, display_name, employee_code, home_store_id')
      .eq('workspace_id', workspaceId)
      .in('id', staffIds)
    if (staffRes.error) throw new Error(staffRes.error.message)
    staffRows = staffRes.data || []
  }

  return presentLockEvents(raw, staffRows, { storeId: storeId || undefined, from, to }).slice(0, cap)
}
