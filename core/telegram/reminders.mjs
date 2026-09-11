// Availability reminders, driven by rules.availability.reminders.
//
// Run once a day (Vercel cron → /api/v1/scheduling/reminders/run, or a
// manager pressing "Send reminders now"). For each workspace: which reminder
// tokens land on `today` (core/scheduling/rules.mjs remindersDueOn), who
// must submit availability (staff.availability_required, active, real, in
// the rules' store list), whether they already have — then one in-app
// notification per person per (month, token), plus a Telegram DM if linked.
// Idempotent: the notifications table is the ledger, so a second run on the
// same day sends nothing new.

import { getWorkspaceSchedulingRules, remindersDueOn, monthBounds, sgToday } from '../scheduling/rules.mjs'
import { createNotification } from '../notifications/record.mjs'
import { monthLabel } from '../roster/query.mjs'
import { sendTelegramToStaff } from './notify.mjs'
import { fmtDate } from './handlers.mjs'
import { escapeHtml } from './client.mjs'

export const REMINDER_NOTIFICATION_TYPE = 'availability_reminder'

/** Copy per reminder kind. `missing` = this person has submitted nothing yet. */
export function reminderCopy({ kind, token, window, missing }) {
  const month = monthLabel(window.month)
  const lock = fmtDate(window.lock_date)
  if (kind === 'open') {
    return {
      title: `${month} availability is open`,
      body: `Submit your availability for ${month} by the end of ${lock}. Days you don't mark count as "can work".`,
      telegram: `📅 <b>${month} availability is open.</b>\nSubmit by end of ${lock}.\n\nSend <code>/avail 3 oct cant</code> style lines, or /help for the format.`,
    }
  }
  if (kind === 'countdown') {
    const n = Number(token.replace(/\D/g, '')) || 0
    const when = n === 1 ? 'tomorrow' : `in ${n} days`
    return {
      title: `${month} availability closes ${when}`,
      body: missing
        ? `You have not submitted anything for ${month}. It locks at the end of ${lock} — after that, changes go through your manager.`
        : `${month} availability locks at the end of ${lock}. Check what you submitted if anything has changed.`,
      telegram: missing
        ? `⏰ <b>${month} availability closes ${when}</b> (end of ${lock}).\nYou have not submitted anything yet — send /avail now, or /help for the format.`
        : `⏰ <b>${month} availability closes ${when}</b> (end of ${lock}).\n/mine shows what you submitted; /avail to change it.`,
    }
  }
  return {
    title: `${month} availability is locked`,
    body: missing
      ? `${month} availability closed on ${lock} and nothing was submitted for you. You will be scheduled as available — talk to your manager if that is wrong.`
      : `${month} availability closed on ${lock}. Your manager is building the roster now; changes go through them.`,
    telegram: missing
      ? `🔒 <b>${month} availability is locked</b> (closed ${lock}) and nothing was submitted for you. You will be scheduled as available — talk to your manager if that is wrong.`
      : `🔒 <b>${month} availability is locked</b> (closed ${lock}). Your manager is building the roster; changes go through them now.`,
  }
}

async function requiredStaff(db, workspaceId, rules) {
  const warnings = []
  let storeIds = null
  if (rules.store_ids?.length) {
    const { data: stores } = await db.from('stores').select('id, code')
      .eq('workspace_id', workspaceId).in('code', rules.store_ids.map((c) => c.toUpperCase()))
    if (stores?.length) storeIds = stores.map((s) => s.id)
    else warnings.push(`rules.store_ids (${rules.store_ids.join(', ')}) matched no store code in this workspace — reminding every store instead. Fix the list on Scheduling rules.`)
  }
  let q = db.from('staff').select('id, employee_code, display_name, home_store_id')
    .eq('workspace_id', workspaceId)
    .eq('employment_status', 'active')
    .eq('availability_required', true)
    .eq('is_dummy', false)
  if (storeIds) q = q.in('home_store_id', storeIds)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return { staff: data || [], warnings }
}

async function submittedSet(db, workspaceId, staffIds, month) {
  if (!staffIds.length) return new Set()
  const { from, to } = monthBounds(month)
  const { data, error } = await db.from('availability').select('staff_id')
    .eq('workspace_id', workspaceId).in('staff_id', staffIds).gte('work_date', from).lte('work_date', to).limit(5000)
  if (error) throw new Error(error.message)
  return new Set((data || []).map((r) => r.staff_id))
}

async function alreadySent(db, workspaceId, staffIds, month, token) {
  if (!staffIds.length) return new Set()
  const { data, error } = await db.from('notifications').select('staff_id')
    .eq('workspace_id', workspaceId).eq('type', REMINDER_NOTIFICATION_TYPE)
    .in('staff_id', staffIds)
    .eq('metadata->>month', month).eq('metadata->>token', token)
  if (error) {
    console.error('[reminders] dedupe lookup failed:', error.message)
    return new Set()
  }
  return new Set((data || []).map((r) => r.staff_id))
}

/**
 * @param {object} db
 * @param {{ workspaceId?: string|null, today?: string, dryRun?: boolean }} opts
 *   workspaceId null → every workspace (cron). dryRun → compute, send nothing.
 */
export async function runAvailabilityReminders(db, { workspaceId = null, today = sgToday(), dryRun = false } = {}) {
  let workspaceIds = []
  if (workspaceId) workspaceIds = [workspaceId]
  else {
    const { data, error } = await db.from('workspaces').select('id')
    if (error) throw new Error(error.message)
    workspaceIds = (data || []).map((w) => w.id)
  }

  const results = []
  for (const wsId of workspaceIds) {
    const { rules, version } = await getWorkspaceSchedulingRules(db, wsId)
    const due = remindersDueOn(rules, today)
    const summary = { workspace_id: wsId, rules_version: version, due: due.map((d) => ({ token: d.token, kind: d.kind, month: d.month })), recipients: 0, sent: 0, telegram_sent: 0, skipped_duplicate: 0, warnings: [], dry_run: dryRun }
    if (!due.length) { results.push(summary); continue }

    const { staff, warnings } = await requiredStaff(db, wsId, rules)
    summary.warnings.push(...warnings)
    const staffIds = staff.map((s) => s.id)

    for (const d of due) {
      const submitted = await submittedSet(db, wsId, staffIds, d.month)
      const recipients = d.kind === 'countdown' ? staff.filter((s) => !submitted.has(s.id)) : staff
      const sentBefore = await alreadySent(db, wsId, recipients.map((s) => s.id), d.month, d.token)
      const fresh = recipients.filter((s) => !sentBefore.has(s.id))
      summary.recipients += recipients.length
      summary.skipped_duplicate += recipients.length - fresh.length
      if (dryRun || !fresh.length) continue

      const copyFor = (s) => reminderCopy({ kind: d.kind, token: d.token, window: d.window, missing: !submitted.has(s.id) })
      for (const s of fresh) {
        const copy = copyFor(s)
        await createNotification(db, {
          workspace_id: wsId, staff_id: s.id, type: REMINDER_NOTIFICATION_TYPE,
          title: copy.title, body: copy.body, link: '/availability',
          metadata: { month: d.month, token: d.token, kind: d.kind, lock_date: d.window.lock_date, missing: !submitted.has(s.id) },
        })
        summary.sent += 1
      }
      const byId = new Map(fresh.map((s) => [s.id, s]))
      const tg = await sendTelegramToStaff(db, wsId, fresh.map((s) => s.id), (staffId) => {
        const s = byId.get(staffId)
        return s ? `${copyFor(s).telegram}\n\n<i>${escapeHtml(s.display_name)} · ${escapeHtml(s.employee_code)}</i>` : ''
      })
      summary.telegram_sent += tg.sent
    }
    results.push(summary)
  }
  return { today, workspaces: results }
}
