import { recordAudit } from '../../../../core/audit/record.mjs'
import { sgToday } from '../../../utils/dates'
import { assertNotLocked } from '../../../utils/payrollLock'
import { verifyStaffClockToken } from '../../../utils/staffQr'

// The clock engine. Staff scan the store's daily QR and post
// { action, qr_token }. Supervisors+ (or attendance:write API keys) may
// record manual events for someone else with { action, staff_id, store_id }.
//
// Adherence: each clock_in/out is compared against the published shift for
// that day; variances outside grace_minutes raise attendance_flags
// (late / early_in / early_out / late_out / unscheduled / ot_daily).
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  const body = await readBody(event)
  const db = getAdminClient()

  const action = String(body?.action || '')
  if (!['clock_in', 'clock_out', 'break_start', 'break_end'].includes(action)) {
    throw apiError(400, 'action must be clock_in | clock_out | break_start | break_end')
  }

  const today = sgToday()
  let staffId: string
  let storeId: string
  let method: 'qr' | 'manual' = 'qr'
  let qrTokenId: string | null = null
  // Reverse scan = a supervisor's device scanned the staff member's own QR.
  // Recorded as a real 'qr' scan, but we keep the operator for accountability.
  let reverseMode = false
  let scannedStaff: { display_name: string; employee_code: string } | null = null

  if (body.qr_token) {
    if (ctx.kind !== 'session') throw apiError(400, 'QR clock requires a staff session')
    const { data: qr } = await db
      .from('qr_tokens').select('*').eq('token', String(body.qr_token)).maybeSingle()
    if (!qr || qr.valid_on !== today || qr.workspace_id !== ctx.workspaceId) {
      throw apiError(422, 'QR code is invalid or expired — codes rotate daily, scan today\'s code at the store')
    }
    staffId = ctx.staff.id
    storeId = qr.store_id
    qrTokenId = qr.id
  } else if (body.staff_qr_token) {
    // REVERSE scan: the store scanner (a supervisor / attendance:write device)
    // reads the staff member's rotating personal QR.
    if (!ctx.has('attendance:write')) {
      throw apiError(403, 'Scanning a staff check-in QR needs supervisor role or attendance:write. Open the check-in scanner as a supervisor.')
    }
    const verified = verifyStaffClockToken(body.staff_qr_token)
    if (!verified) {
      throw apiError(422, 'That check-in QR is invalid or has expired — staff codes refresh every minute, ask them to show a fresh one.')
    }
    // The token only carries an id; confirm they are a real, active person in
    // THIS workspace before clocking them (multi-workspace safety).
    const { data: st } = await db
      .from('staff').select('id, employment_status, display_name, employee_code')
      .eq('workspace_id', ctx.workspaceId).eq('id', verified.staffId).maybeSingle()
    if (!st || st.employment_status !== 'active') {
      throw apiError(422, 'That check-in QR does not match an active staff member in this workspace.')
    }
    scannedStaff = { display_name: st.display_name, employee_code: st.employee_code }
    staffId = verified.staffId
    storeId = String(body.store_id || (ctx.kind === 'session' ? ctx.staff.home_store_id : '') || '')
    if (!storeId) throw apiError(400, 'store_id is required when scanning a staff check-in QR.')
    reverseMode = true
  } else if (ctx.kind === 'session' && action !== 'clock_in' && !body.staff_id) {
    // Self-service close/break on my own open entry: the open entry proves
    // the QR clock-in, so clocking out or toggling a break needs no rescan.
    // Only clock_in demands today's store QR.
    staffId = ctx.staff.id
    storeId = '' // resolved from the open entry below
  } else {
    // Manual entry: supervisor+ for someone else, or an attendance:write key.
    const canManual = ctx.has('attendance:write')
    if (!canManual) throw apiError(403, 'Manual clock entries require supervisor role or attendance:write scope. Staff clock via the store QR.')
    staffId = String(body.staff_id || (ctx.kind === 'session' ? ctx.staff.id : ''))
    storeId = String(body.store_id || '')
    if (!staffId || !storeId) throw apiError(400, 'staff_id and store_id are required for manual entries')
    method = 'manual'
  }

  await assertNotLocked(ctx.workspaceId, today)
  const now = new Date()
  const settings = await getWorkspaceSettings(ctx.workspaceId)
  const grace = Number(settings.grace_minutes) || 5

  // Today's published shift for adherence comparison (may be null).
  const { data: shifts } = await db
    .from('shifts')
    .select('*, roster:roster_id(status)')
    .eq('workspace_id', ctx.workspaceId)
    .eq('staff_id', staffId)
    .eq('work_date', today)
    .neq('status', 'cancelled')
  const shift = (shifts || []).find((s: any) => s.roster?.status === 'published') || null

  // Open entry = today's row without clock_out.
  const { data: openEntries } = await db
    .from('time_entries')
    .select('*')
    .eq('workspace_id', ctx.workspaceId)
    .eq('staff_id', staffId)
    .eq('work_date', today)
    .is('clock_out_at', null)
    .order('created_at', { ascending: false })
  const open = openEntries?.[0] || null
  if (!storeId) storeId = open?.store_id || ctx.staff?.home_store_id || ''

  const flags: Array<{ flag_type: string; details: any; time_entry_id?: string }> = []
  let entry: any = null

  if (action === 'clock_in') {
    if (open) throw apiError(409, 'Already clocked in — clock out first')
    const { data, error } = await db.from('time_entries').insert({
      workspace_id: ctx.workspaceId,
      store_id: storeId,
      staff_id: staffId,
      shift_id: shift?.id || null,
      work_date: today,
      clock_in_at: now.toISOString(),
      job_code: shift?.job_code || body.job_code || null,
      source: method === 'manual' ? 'manual' : 'clock',
      status: 'open',
    }).select().single()
    if (error) throw apiError(500, error.message)
    entry = data
    if (shift) {
      const deltaMin = Math.round((now.getTime() - new Date(shift.start_at).getTime()) / 60000)
      if (deltaMin > grace) flags.push({ flag_type: 'late', details: { minutes_late: deltaMin, grace_minutes: grace }, time_entry_id: data.id })
      else if (deltaMin < -grace) flags.push({ flag_type: 'early_in', details: { minutes_early: -deltaMin, grace_minutes: grace }, time_entry_id: data.id })
    } else {
      flags.push({ flag_type: 'unscheduled', details: { note: 'Clock-in with no published shift today' }, time_entry_id: data.id })
    }
  } else {
    if (!open) throw apiError(409, action === 'clock_out' ? 'No open entry — clock in first' : 'No open entry to track a break on')

    if (action === 'break_start') {
      if (open.break_open_at) throw apiError(409, 'Break already running')
      const { data, error } = await db.from('time_entries')
        .update({ break_open_at: now.toISOString(), updated_at: now.toISOString() })
        .eq('id', open.id).select().single()
      if (error) throw apiError(500, error.message)
      entry = data
    } else if (action === 'break_end') {
      if (!open.break_open_at) throw apiError(409, 'No break running')
      const added = Math.max(1, Math.round((now.getTime() - new Date(open.break_open_at).getTime()) / 60000))
      const { data, error } = await db.from('time_entries')
        .update({ break_minutes: (open.break_minutes || 0) + added, break_open_at: null, updated_at: now.toISOString() })
        .eq('id', open.id).select().single()
      if (error) throw apiError(500, error.message)
      entry = data
    } else { // clock_out
      const patch: Record<string, any> = {
        clock_out_at: now.toISOString(),
        status: 'closed',
        updated_at: now.toISOString(),
      }
      if (open.break_open_at) { // close a dangling break
        patch.break_minutes = (open.break_minutes || 0) + Math.max(1, Math.round((now.getTime() - new Date(open.break_open_at).getTime()) / 60000))
        patch.break_open_at = null
      }
      const { data, error } = await db.from('time_entries').update(patch).eq('id', open.id).select().single()
      if (error) throw apiError(500, error.message)
      entry = data
      if (shift) {
        const deltaMin = Math.round((now.getTime() - new Date(shift.end_at).getTime()) / 60000)
        if (deltaMin < -grace) flags.push({ flag_type: 'early_out', details: { minutes_early: -deltaMin, grace_minutes: grace }, time_entry_id: data.id })
        else if (deltaMin > grace) flags.push({ flag_type: 'late_out', details: { minutes_late: deltaMin, grace_minutes: grace }, time_entry_id: data.id })
      }
      const netHours = (new Date(data.clock_out_at).getTime() - new Date(data.clock_in_at).getTime()) / 3600000 - (data.break_minutes || 0) / 60
      const dailyThreshold = Number(settings.ot_daily_threshold_hours) || 12
      if (netHours > dailyThreshold) {
        flags.push({ flag_type: 'ot_daily', details: { hours: Math.round(netHours * 100) / 100, threshold: dailyThreshold }, time_entry_id: data.id })
      }
    }
  }

  await db.from('clock_events').insert({
    workspace_id: ctx.workspaceId,
    store_id: storeId,
    staff_id: staffId,
    type: action,
    at: now.toISOString(),
    method,
    qr_token_id: qrTokenId,
    device_id: body.device_id || null,
    recorded_by: (method === 'manual' || reverseMode) && ctx.kind === 'session' ? ctx.staff.id : null,
    note: body.note || null,
  })

  for (const f of flags) {
    await db.from('attendance_flags').insert({
      workspace_id: ctx.workspaceId,
      staff_id: staffId,
      store_id: storeId,
      shift_id: shift?.id || null,
      time_entry_id: f.time_entry_id || null,
      work_date: today,
      flag_type: f.flag_type,
      details: f.details,
    })
  }

  if (method === 'manual') {
    await recordAudit(db, {
      workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
      actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
      object_type: 'time_entries', entity_id: entry?.id, operation: 'ACTION',
      after_data: entry, metadata: { action, manual_for: staffId },
    })
  }

  return { data: entry, action, flags: flags.map((f) => f.flag_type), staff: scannedStaff }
})
