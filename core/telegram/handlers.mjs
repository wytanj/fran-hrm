// Telegram bot command handlers. The bot is an INTAKE surface: every write
// goes through the same core functions as the web app (submitAvailability,
// the scheduling rules, the lock tables), so chat history is never the
// source of truth and a rule change in /scheduling-rules changes what the
// bot accepts on the next message.
//
// Commands: /start /help /link <code> <PIN> /unlink /status /mine /avail …
// /avail grammar (one entry per line; the first may follow the command):
//   /avail 2026-10-03 cant
//   /avail 3 oct can 10:00-18:00
//   /avail 3/10..5/10 prefer
//   /avail oct 3-5 cant
// kinds: can|ok|yes|available → available · prefer|want → preferred ·
//        cant|can't|no|off|x|unavailable → unavailable

import { submitAvailability, listAvailability, monthLabel } from '../roster/query.mjs'
import { getWorkspaceSchedulingRules, currentAvailabilityMonth, sgToday, addDays, monthBounds } from '../scheduling/rules.mjs'
import { linkTelegram, resolveTelegramStaff, unlinkTelegram } from './identity.mjs'
import { sendMessage, answerCallbackQuery, deleteMessage, escapeHtml } from './client.mjs'

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const KIND_WORDS = {
  available: ['can', 'ok', 'yes', 'available', 'avail', 'free', 'y'],
  preferred: ['prefer', 'preferred', 'want', 'pref', 'p'],
  unavailable: ['cant', "can't", 'cannot', 'no', 'off', 'x', 'unavailable', 'n', 'nope', 'busy'],
}
const KIND_LABEL = { available: 'Can work', preferred: 'Prefer', unavailable: "Can't" }

// ───────────────────────── /avail parsing (pure) ─────────────────────────

function pad(n) { return String(n).padStart(2, '0') }

function validDate(y, m, d) {
  if (!(m >= 1 && m <= 12) || !(d >= 1 && d <= 31)) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  if (dt.getUTCMonth() !== m - 1) return null
  return `${y}-${pad(m)}-${pad(d)}`
}

/** Pick the year that puts (m, d) on/after today (never more than ~30 days back). */
function inferYear(m, d, today) {
  const y = Number(today.slice(0, 4))
  const candidate = validDate(y, m, d)
  if (candidate && candidate >= addDays(today, -30)) return candidate
  return validDate(y + 1, m, d)
}

function parseSingleDate(tok, today, ctxMonth = null) {
  const t = tok.toLowerCase().replace(/,$/, '')
  let m
  if ((m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return validDate(Number(m[1]), Number(m[2]), Number(m[3]))
  if ((m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) {
    const d = Number(m[1]); const mo = Number(m[2])
    if (m[3]) return validDate(m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), mo, d)
    return inferYear(mo, d, today)
  }
  if ((m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?$/)) && ctxMonth) {
    return validDate(Number(ctxMonth.slice(0, 4)), Number(ctxMonth.slice(5, 7)), Number(m[1]))
  }
  return null
}

function monthIndex(word) {
  const w = String(word || '').toLowerCase().slice(0, 3)
  const i = MONTHS.indexOf(w)
  return i === -1 ? null : i + 1
}

function kindOf(word) {
  const w = String(word || '').toLowerCase()
  for (const [kind, words] of Object.entries(KIND_WORDS)) if (words.includes(w)) return kind
  return null
}

/** "10:00-18:00", "10-18", "9:30..14:00", "10to18" → { start_time, end_time } or null. */
function parseTimeWindow(tok) {
  const m = String(tok || '').match(/^(\d{1,2})(?::(\d{2}))?(?:-|–|\.\.|to)(\d{1,2})(?::(\d{2}))?$/i)
  if (!m) return null
  const sh = Number(m[1]); const sm = Number(m[2] || 0); const eh = Number(m[3]); const em = Number(m[4] || 0)
  if (sh > 23 || eh > 24 || sm > 59 || em > 59) return null
  const start = `${pad(sh)}:${pad(sm)}`
  const end = `${pad(eh === 24 ? 23 : eh)}:${pad(eh === 24 ? 59 : em)}`
  if (end <= start) return null
  return { start_time: start, end_time: end }
}

function eachDate(from, to) {
  const out = []
  for (let d = from; d <= to && out.length < 62; d = addDays(d, 1)) out.push(d)
  return out
}

/**
 * Parse the text of an /avail message into availability entries.
 * @returns {{ entries: Array<{work_date, kind, start_time, end_time}>, errors: string[] }}
 */
export function parseAvailLines(text, { today = sgToday() } = {}) {
  const body = String(text || '').replace(/^\/avail(?:ability)?(@\w+)?\s*/i, '')
  const lines = body.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean)
  const entries = []
  const errors = []
  for (const line of lines) {
    const tokens = line.split(/\s+/)
    let kind = null
    let window = null
    let ctxMonth = null           // 'YYYY-MM' once a month word is seen
    const dates = []              // resolved YYYY-MM-DD
    let pendingDays = []          // bare day numbers waiting for a month word
    const lineErr = (m) => errors.push(`"${line}": ${m}`)

    const applyMonth = (ym) => {
      for (const d of pendingDays) {
        const dd = validDate(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), d)
        if (dd) dates.push(dd); else lineErr(`day ${d} is not in ${ym}`)
      }
      pendingDays = []
    }

    let i = 0
    while (i < tokens.length) {
      const tok = tokens[i].replace(/,$/, '')
      const lower = tok.toLowerCase()
      let m

      const k = kindOf(lower)
      if (k) { kind = k; i += 1; continue }

      // Month word: "oct" / "October". Resolves any bare days before it and
      // sets the context for bare days after it.
      const mi = monthIndex(lower)
      if (mi && /^[a-z]+$/.test(lower)) {
        const y = inferYear(mi, 1, today).slice(0, 4)
        ctxMonth = `${y}-${pad(mi)}`
        applyMonth(ctxMonth)
        i += 1; continue
      }

      // Time window with colons is unambiguous: 10:00-18:00, also "10:00 - 18:00" / "10:00 to 18:00".
      if (/^\d{1,2}:\d{2}$/.test(tok) && tokens[i + 1] && /^[-–]$|^to$/i.test(tokens[i + 1]) && tokens[i + 2]) {
        const tw = parseTimeWindow(`${tok}-${tokens[i + 2].replace(/,$/, '')}`)
        if (tw) { window = tw; i += 3; continue }
      }
      if (/:/.test(tok) && (m = parseTimeWindow(tok))) { window = m; i += 1; continue }

      // Full-date range: 2026-10-03..2026-10-05, 3/10..5/10, 3/10-5/10
      if ((m = tok.match(/^(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)(?:\.\.|–|-)(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)$/))) {
        const a = parseSingleDate(m[1], today); const b = parseSingleDate(m[2], today)
        if (a && b && a <= b) { dates.push(...eachDate(a, b)); i += 1; continue }
        lineErr(`"${tok}" is not a valid date range`); i += 1; continue
      }

      // Bare number range "3-5": a day range when no date is on the line
      // yet, a bare-hour time window ("10-18") once a date has been given.
      if ((m = tok.match(/^(\d{1,2})(?:\.\.|–|-)(\d{1,2})$/))) {
        if (!dates.length && !pendingDays.length) {
          const a = Number(m[1]); const b = Number(m[2])
          if (a >= 1 && b >= a && b <= 31) {
            for (let d = a; d <= b; d++) pendingDays.push(d)
            if (ctxMonth) applyMonth(ctxMonth)
            i += 1; continue
          }
        }
        const tw = parseTimeWindow(tok)
        if (tw) { window = tw; i += 1; continue }
        lineErr(`could not read "${tok}"`); i += 1; continue
      }

      // "3 to 5" / "3 Oct to 5 Oct" / "2026-10-03 to 2026-10-05"
      if (/^to$/i.test(lower) && tokens[i + 1]) {
        const next = tokens[i + 1].replace(/,$/, '')
        const last = dates[dates.length - 1]
        const b = parseSingleDate(next, today, ctxMonth)
        if (last && b && b >= last) { dates.push(...eachDate(addDays(last, 1), b)); i += 2; continue }
        if (pendingDays.length && /^\d{1,2}(?:st|nd|rd|th)?$/.test(next)) {
          const a = pendingDays[pendingDays.length - 1]; const bb = Number(next.replace(/\D/g, ''))
          for (let d = a + 1; d <= bb && d <= 31; d++) pendingDays.push(d)
          i += 2; continue
        }
        lineErr(`could not read "to ${next}"`); i += 2; continue
      }

      const single = parseSingleDate(tok, today, null)
      if (single) { dates.push(single); i += 1; continue }

      if (/^\d{1,2}(?:st|nd|rd|th)?$/.test(lower)) {
        const d = Number(lower.replace(/\D/g, ''))
        if (ctxMonth) {
          const dd = validDate(Number(ctxMonth.slice(0, 4)), Number(ctxMonth.slice(5, 7)), d)
          if (dd) dates.push(dd); else lineErr(`day ${d} is not in ${ctxMonth}`)
        } else pendingDays.push(d)
        i += 1; continue
      }

      lineErr(`could not read "${tok}"`)
      i += 1
    }

    if (pendingDays.length) lineErr(`which month is "${pendingDays.join(', ')}"? Write it as 3 Oct or 2026-10-03`)
    if (!dates.length) { if (!errors.some((e) => e.startsWith(`"${line}"`))) lineErr('no date found'); continue }
    if (!kind) { lineErr('say can, prefer or cant'); continue }
    if (kind === 'unavailable') window = null
    for (const work_date of dates) {
      entries.push({ work_date, kind, start_time: window?.start_time || null, end_time: window?.end_time || null })
    }
  }
  // Last write wins per date.
  const byDate = new Map()
  for (const e of entries) byDate.set(e.work_date, e)
  return { entries: [...byDate.values()].sort((a, b) => (a.work_date < b.work_date ? -1 : 1)), errors }
}

// ───────────────────────── replies ─────────────────────────

const HELP = [
  '<b>FranHRM availability bot</b>',
  '',
  '/link &lt;employee code&gt; &lt;PIN&gt; — connect this Telegram to your staff record (same code + PIN as the web sign-in)',
  '/status — which month is open, the lock date, and what you have submitted',
  '/avail — submit or change availability, one line per day or range:',
  '   <code>/avail 3 oct cant</code>',
  '   <code>/avail 2026-10-04 can 10:00-18:00</code>',
  '   <code>/avail oct 6-8 prefer</code>',
  '   (kinds: can · prefer · cant)',
  '/mine — everything you have submitted for the open month',
  '/unlink — disconnect this Telegram',
  '',
  'Managers see the same truth on FranHRM → Scheduling truth. The rules (open day, lock day, reminders) live on FranHRM → Scheduling rules.',
].join('\n')

export function fmtDate(d) {
  const m = String(d).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return d
  const mon = MONTHS[Number(m[2]) - 1]
  return `${Number(m[3])} ${mon[0].toUpperCase()}${mon.slice(1)}`
}

async function workspaceSettings(db, workspaceId) {
  const { data } = await db.from('workspaces').select('settings').eq('id', workspaceId).maybeSingle()
  return data?.settings || {}
}

function requireLinkedText() {
  return 'This Telegram is not linked to a staff record yet. Send <code>/link &lt;employee code&gt; &lt;PIN&gt;</code> — the same code and PIN you use to sign in to FranHRM.'
}

async function statusText(db, staff) {
  const { rules, version } = await getWorkspaceSchedulingRules(db, staff.workspace_id)
  const today = sgToday()
  const w = currentAvailabilityMonth(rules, today)
  const { from, to } = monthBounds(w.month)
  const rows = await listAvailability(db, staff.workspace_id, { staff_id: staff.id, from, to })
  const cant = rows.filter((r) => r.kind === 'unavailable').length
  const pref = rows.filter((r) => r.kind === 'preferred').length
  const lines = [`<b>${escapeHtml(staff.display_name)}</b> (${escapeHtml(staff.employee_code)})`]
  if (staff.availability_required === false) {
    lines.push('Your role does not need day-by-day availability — you are scheduled on a fixed pattern. Ask your manager if that should change.')
  }
  lines.push('')
  lines.push(`<b>${monthLabel(w.month)}</b> availability window`)
  if (w.state === 'upcoming') lines.push(`Opens ${fmtDate(w.open_date)}, closes end of ${fmtDate(w.lock_date)}.`)
  else if (w.state === 'open') lines.push(`Open now — closes end of ${fmtDate(w.lock_date)} (${w.days_until_lock} day${w.days_until_lock === 1 ? '' : 's'} left).`)
  else lines.push(`Closed on ${fmtDate(w.lock_date)}. Changes now go through your manager.`)
  lines.push(`Submitted: ${rows.length} day${rows.length === 1 ? '' : 's'} (${cant} can't, ${pref} prefer).`)
  if (!rows.length && staff.availability_required !== false) lines.push('⚠️ Nothing submitted yet — send /avail.')
  lines.push('')
  lines.push(`Rules v${version}: open day ${rules.availability.open_day_of_prior_month}, lock day ${rules.availability.lock_day_of_prior_month} of the prior month.`)
  return lines.join('\n')
}

async function mineText(db, staff) {
  const { rules } = await getWorkspaceSchedulingRules(db, staff.workspace_id)
  const w = currentAvailabilityMonth(rules, sgToday())
  const { from, to } = monthBounds(w.month)
  const rows = await listAvailability(db, staff.workspace_id, { staff_id: staff.id, from, to })
  if (!rows.length) return `Nothing submitted for ${monthLabel(w.month)} yet. Send /avail to add days.`
  const lines = [`<b>${monthLabel(w.month)}</b> — ${rows.length} day${rows.length === 1 ? '' : 's'}`]
  for (const r of rows) {
    const win = r.start_time && r.end_time ? ` ${r.start_time.slice(0, 5)}–${r.end_time.slice(0, 5)}` : ''
    lines.push(`${fmtDate(r.work_date)}: ${KIND_LABEL[r.kind] || r.kind}${win}`)
  }
  return lines.join('\n')
}

// ───────────────────────── dispatcher ─────────────────────────

/**
 * Handle one Telegram update. Never throws — the webhook must answer 200.
 * Returns a small summary for logs/tests: { handled, command, … }.
 * `send` is injectable so tests can capture replies without a token.
 */
export async function handleUpdate(db, update, { today = sgToday(), send = sendMessage } = {}) {
  try {
    if (update?.callback_query) return await handleCallback(db, update.callback_query, { today, send })
    const msg = update?.message || update?.edited_message
    if (!msg || typeof msg.text !== 'string') return { handled: false }
    const chatId = msg.chat?.id
    const from = msg.from || {}
    const text = msg.text.trim()
    const cmdMatch = text.match(/^\/([a-zA-Z_]+)(?:@\w+)?(?:\s|$)/)
    const command = cmdMatch ? cmdMatch[1].toLowerCase() : null
    const reply = (t, extra) => send(chatId, t, extra)

    if (!command) {
      const linked = await resolveTelegramStaff(db, from.id)
      if (!linked) { await reply(requireLinkedText()); return { handled: true, command: null } }
      await reply('I only understand commands. Try /status, /avail or /help.')
      return { handled: true, command: null }
    }

    switch (command) {
      case 'start': {
        const linked = await resolveTelegramStaff(db, from.id)
        if (linked) {
          await reply(`Welcome back, <b>${escapeHtml(linked.staff.display_name)}</b>. You are linked as ${escapeHtml(linked.staff.employee_code)}.\n\n${HELP}`, startKeyboard())
        } else {
          await reply(`Hi${from.first_name ? ` ${escapeHtml(from.first_name)}` : ''} — this is the FranHRM availability bot.\n\nFirst, connect this Telegram to your staff record:\n<code>/link &lt;employee code&gt; &lt;PIN&gt;</code>\n(the same code and PIN you use to sign in to FranHRM)\n\nThen /status shows which month is open and /avail lets you submit days.`)
        }
        return { handled: true, command }
      }
      case 'help': {
        await reply(HELP, startKeyboard())
        return { handled: true, command }
      }
      case 'link': {
        const parts = text.split(/\s+/).slice(1)
        // Scrub the PIN from the chat as soon as we have it (best effort).
        deleteMessage(chatId, msg.message_id).catch(() => {})
        try {
          const { staff, replaced } = await linkTelegram(db, {
            telegram_user_id: from.id, chat_id: chatId, username: from.username || null,
            employee_code: parts[0], pin: parts[1],
          })
          await reply(`Linked ✅ You are <b>${escapeHtml(staff.display_name)}</b> (${escapeHtml(staff.employee_code)}).${replaced ? ' This Telegram was previously linked to someone else; that link has been removed.' : ''}\n\nI deleted your message with the PIN in it. Send /status to see the open month.`)
          return { handled: true, command, linked: staff.id }
        } catch (err) {
          await reply(escapeHtml(err?.message || 'Could not link.'))
          return { handled: true, command, error: err?.code || 'link_failed' }
        }
      }
      case 'unlink': {
        const ok = await unlinkTelegram(db, from.id)
        await reply(ok ? 'Unlinked. Send /link &lt;employee code&gt; &lt;PIN&gt; to connect again.' : 'This Telegram was not linked to anyone.')
        return { handled: true, command }
      }
      case 'status': {
        const linked = await resolveTelegramStaff(db, from.id)
        if (!linked) { await reply(requireLinkedText()); return { handled: true, command, error: 'unlinked' } }
        await reply(await statusText(db, linked.staff))
        return { handled: true, command }
      }
      case 'mine': {
        const linked = await resolveTelegramStaff(db, from.id)
        if (!linked) { await reply(requireLinkedText()); return { handled: true, command, error: 'unlinked' } }
        await reply(await mineText(db, linked.staff))
        return { handled: true, command }
      }
      case 'avail':
      case 'availability': {
        const linked = await resolveTelegramStaff(db, from.id)
        if (!linked) { await reply(requireLinkedText()); return { handled: true, command, error: 'unlinked' } }
        const { entries, errors } = parseAvailLines(text, { today })
        if (!entries.length) {
          const why = errors.length ? `\n\n${errors.map(escapeHtml).join('\n')}` : ''
          await reply(`Tell me the day(s) and whether you can work, one per line:\n<code>/avail 3 oct cant</code>\n<code>/avail 2026-10-04 can 10:00-18:00</code>\n<code>/avail oct 6-8 prefer</code>${why}`)
          return { handled: true, command, error: 'parse' }
        }
        const staff = linked.staff
        const [settings, { rules }] = await Promise.all([
          workspaceSettings(db, staff.workspace_id),
          getWorkspaceSchedulingRules(db, staff.workspace_id),
        ])
        try {
          const { dates } = await submitAvailability(db, staff.workspace_id, {
            staffId: staff.id, entries, isManager: false,
            cutoffDays: Number(settings.availability_cutoff_days) || 7, rules, today,
          }, { actor_kind: 'user', actor_id: staff.id, actor_name: staff.display_name, source_type: 'api' })
          const lines = entries.map((e) => {
            const win = e.start_time ? ` ${e.start_time}–${e.end_time}` : ''
            return `${fmtDate(e.work_date)}: ${KIND_LABEL[e.kind]}${win}`
          })
          const skipped = errors.length ? `\n\nIgnored:\n${errors.map(escapeHtml).join('\n')}` : ''
          await reply(`Saved ✅ ${dates.length} day${dates.length === 1 ? '' : 's'}\n${lines.join('\n')}${skipped}\n\n/mine shows the whole month.`)
          return { handled: true, command, saved: dates.length }
        } catch (err) {
          await reply(`Not saved ❌ ${escapeHtml(err?.message || 'Could not save availability')}`)
          return { handled: true, command, error: 'submit', message: err?.message }
        }
      }
      default:
        await reply(`I don't know /${escapeHtml(command)}.\n\n${HELP}`)
        return { handled: true, command, error: 'unknown' }
    }
  } catch (err) {
    console.error('[telegram] handleUpdate failed:', err?.message || err)
    return { handled: false, error: err?.message || String(err) }
  }
}

function startKeyboard() {
  return { replyMarkup: { inline_keyboard: [[{ text: 'My status', callback_data: 'status' }, { text: 'What I submitted', callback_data: 'mine' }]] } }
}

async function handleCallback(db, cq, { send }) {
  const chatId = cq.message?.chat?.id
  const data = String(cq.data || '')
  await answerCallbackQuery(cq.id)
  if (!chatId) return { handled: false }
  if (data === 'status' || data === 'mine') {
    const linked = await resolveTelegramStaff(db, cq.from?.id)
    if (!linked) { await send(chatId, requireLinkedText()); return { handled: true, command: data, error: 'unlinked' } }
    await send(chatId, data === 'status' ? await statusText(db, linked.staff) : await mineText(db, linked.staff))
    return { handled: true, command: data }
  }
  return { handled: false, command: data }
}
