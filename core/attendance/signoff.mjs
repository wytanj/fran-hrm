// Weekly timesheet sign-off — the operational close a supervisor does per
// store, per week. Shared by the REST routes and the MCP tools so the web app
// and an agent report the same status (open / signed_off / overdue) and apply
// the same soft-close rule on edits.
//
// "Overdue" is never stored — it is derived (unsigned past week_end + 7 days),
// so it becomes true on its own as time passes without a write.

const DAY = 86_400_000
const OVERDUE_GRACE_DAYS = 7 // a week is overdue once week_end + 7d has passed

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export function mondayOf(date) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
function sgToday() {
  return new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
}

/** Is an open week overdue as of `today` (SGT)? week_end = week_start + 6d. */
export function isOverdue(weekStart, status, today = sgToday()) {
  if (status === 'signed_off') return false
  return today > addDays(weekStart, 6 + OVERDUE_GRACE_DAYS)
}

/**
 * Per-store-week sign-off status across a date range. Includes any week that
 * has time entries (needs signing) or already has a row, newest first.
 * @returns {Promise<{ weeks: Array, overdue_count: number }>}
 */
export async function listTimesheetWeeks(db, workspaceId, { storeId, from, to } = {}) {
  const today = sgToday()
  const firstMon = mondayOf(from || today)
  const lastMon = mondayOf(to || today)
  const weekStarts = []
  for (let w = firstMon; w <= lastMon; w = addDays(w, 7)) weekStarts.push(w)
  if (!weekStarts.length) weekStarts.push(firstMon)
  const rangeStart = weekStarts[0]
  const rangeEnd = addDays(weekStarts[weekStarts.length - 1], 6)

  // Stores in scope.
  let storesQ = db.from('stores').select('id, code, name').eq('workspace_id', workspaceId).eq('kind', 'store')
  if (storeId) storesQ = storesQ.eq('id', storeId)
  const { data: stores } = await storesQ
  const storeList = stores || []
  const storeIds = storeList.map((s) => s.id)
  if (!storeIds.length) return { weeks: [], overdue_count: 0 }

  // Existing sign-off rows + the entries that make a week need signing.
  const [rowsRes, entriesRes] = await Promise.all([
    db.from('timesheet_weeks')
      .select('*, signer:signed_off_by(display_name), amender:last_amended_by(display_name)')
      .eq('workspace_id', workspaceId).in('store_id', storeIds)
      .gte('week_start', rangeStart).lte('week_start', lastMon),
    db.from('time_entries')
      .select('store_id, staff_id, work_date')
      .eq('workspace_id', workspaceId).in('store_id', storeIds)
      .gte('work_date', rangeStart).lte('work_date', rangeEnd).limit(5000),
  ])
  const rowByKey = new Map()
  for (const r of rowsRes.data || []) rowByKey.set(`${r.store_id}|${r.week_start}`, r)

  // Aggregate entry volume per (store, week).
  const agg = new Map()
  for (const e of entriesRes.data || []) {
    const key = `${e.store_id}|${mondayOf(e.work_date)}`
    const a = agg.get(key) || { entries: 0, staff: new Set() }
    a.entries += 1
    if (e.staff_id) a.staff.add(e.staff_id)
    agg.set(key, a)
  }

  const storeName = new Map(storeList.map((s) => [s.id, { code: s.code, name: s.name }]))
  const weeks = []
  for (const s of storeList) {
    for (const wk of weekStarts) {
      const key = `${s.id}|${wk}`
      const row = rowByKey.get(key)
      const a = agg.get(key)
      // Skip empty weeks that were never touched and never signed.
      if (!row && !a) continue
      const status = row?.status || 'open'
      weeks.push({
        store_id: s.id,
        store: storeName.get(s.id) || null,
        week_start: wk,
        week_end: addDays(wk, 6),
        status,
        overdue: isOverdue(wk, status, today),
        signed_off_by: row?.signer?.display_name || null,
        signed_off_at: row?.signed_off_at || null,
        amended_count: row?.amended_count || 0,
        amended_at: row?.amended_at || null,
        last_amended_by: row?.amender?.display_name || null,
        entry_count: a?.entries || 0,
        staff_count: a ? a.staff.size : 0,
      })
    }
  }
  weeks.sort((x, y) => y.week_start.localeCompare(x.week_start) || String(x.store?.code).localeCompare(String(y.store?.code)))
  return { weeks, overdue_count: weeks.filter((w) => w.overdue).length }
}

/** Sign off a store's week. Idempotent: signing an already-signed week is a no-op. */
export async function signOffWeek(db, workspaceId, { storeId, weekStart, actor = {} }) {
  const week = mondayOf(weekStart)
  const { data, error } = await db.from('timesheet_weeks').upsert({
    workspace_id: workspaceId,
    store_id: storeId,
    week_start: week,
    status: 'signed_off',
    signed_off_by: actor.staffId || null,
    signed_off_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id,store_id,week_start' }).select().single()
  if (error) throw new Error(error.message)
  return data
}

/** Reopen a signed-off week (keeps the amendment counters as history). */
export async function reopenWeek(db, workspaceId, { storeId, weekStart, actor = {} }) {
  const week = mondayOf(weekStart)
  const { data, error } = await db.from('timesheet_weeks').upsert({
    workspace_id: workspaceId,
    store_id: storeId,
    week_start: week,
    status: 'open',
    signed_off_by: null,
    signed_off_at: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id,store_id,week_start' }).select().single()
  if (error) throw new Error(error.message)
  return data
}

/** The sign-off row for the week containing workDate, or null. */
export async function getSignoffForDate(db, workspaceId, storeId, workDate) {
  const week = mondayOf(workDate)
  const { data } = await db.from('timesheet_weeks')
    .select('*').eq('workspace_id', workspaceId).eq('store_id', storeId).eq('week_start', week).maybeSingle()
  return data || null
}

/**
 * Called by an edit that touches a work date. If that store-week is signed off,
 * the edit is a post-close amendment: record it (bump counters) so the week
 * shows as needing re-review. The caller enforces the reason + writes the audit.
 * @returns {Promise<{ amended: boolean, week: object|null }>}
 */
export async function recordAmendmentIfSignedOff(db, workspaceId, { storeId, workDate, actor = {} }) {
  const row = await getSignoffForDate(db, workspaceId, storeId, workDate)
  if (!row || row.status !== 'signed_off') return { amended: false, week: row }
  const { data } = await db.from('timesheet_weeks').update({
    amended_count: (row.amended_count || 0) + 1,
    amended_at: new Date().toISOString(),
    last_amended_by: actor.staffId || null,
    updated_at: new Date().toISOString(),
  }).eq('id', row.id).select().single()
  return { amended: true, week: data || row }
}
