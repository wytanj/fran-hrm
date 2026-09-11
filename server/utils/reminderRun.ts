import { runAvailabilityReminders } from '../../core/telegram/reminders.mjs'

// Shared by GET (Vercel cron) and POST (manager button / curl) variants of
// /api/v1/scheduling/reminders/run.
//
// Two ways in:
//   1. CRON_SECRET — `Authorization: Bearer <CRON_SECRET>` (what Vercel cron
//      sends automatically) or `X-Cron-Secret: <CRON_SECRET>`. Runs EVERY
//      workspace, which is what a scheduled job wants.
//   2. A normal actor with roster:write — runs their own workspace only.
export async function handleReminderRun(event: any) {
  const q = getQuery(event)
  const body = event.method === 'POST' ? await readBody(event).catch(() => ({})) : {}
  const dateRaw = String(body?.date || q.date || '').trim()
  const dryRun = body?.dry_run === true || q.dry_run === 'true' || q.dry_run === '1'
  const today = dateRaw ? assertDate(dateRaw, 'date') : undefined

  const cronSecret = process.env.CRON_SECRET || ''
  const auth = getHeader(event, 'authorization') || ''
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const viaCron = Boolean(cronSecret) && (bearer === cronSecret || (getHeader(event, 'x-cron-secret') || '') === cronSecret)

  const db = getAdminClient()
  if (viaCron) {
    const result = await runAvailabilityReminders(db, { workspaceId: null, today, dryRun })
    return { ok: true, via: 'cron', ...result }
  }

  const ctx = await requireActor(event, { scope: 'roster:write' })
  const result = await runAvailabilityReminders(db, { workspaceId: ctx.workspaceId, today, dryRun })
  return { ok: true, via: ctx.kind, ...result }
}
