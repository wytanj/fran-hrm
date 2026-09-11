// "Your roster is published" — one in-app notification per assigned person
// per publish (plus a Telegram DM when linked), listing their shifts for the
// week. Side-effect of publish; never throws, never blocks the publish.

import { createNotification } from '../notifications/record.mjs'
import { sendTelegramToStaff } from '../telegram/notify.mjs'
import { escapeHtml } from '../telegram/client.mjs'
import { formatDayShort } from './lockCopy.mjs'

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function dowOf(date) {
  return DOW[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7]
}

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })
}

/**
 * @param {object} db
 * @param {string} workspaceId
 * @param {{ roster: object, shifts: object[], storeName?: string|null, actorName?: string|null, isRepublish?: boolean }} input
 * @returns {Promise<{ recipients: number, telegram_sent: number }>}
 */
export async function notifyRosterPublished(db, workspaceId, { roster, shifts, storeName = null, actorName = null, isRepublish = false }) {
  try {
    const byStaff = new Map()
    for (const sh of shifts || []) {
      if (!sh.staff_id || sh.status === 'cancelled') continue
      const list = byStaff.get(sh.staff_id) || []
      list.push(sh)
      byStaff.set(sh.staff_id, list)
    }
    if (!byStaff.size) return { recipients: 0, telegram_sent: 0 }

    const weekEnd = new Date(`${roster.week_start}T00:00:00Z`)
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6)
    const weekLabel = `${formatDayShort(roster.week_start)}–${formatDayShort(weekEnd.toISOString().slice(0, 10))}`
    const where = storeName ? ` at ${storeName}` : ''
    const verb = isRepublish ? 'updated' : 'published'
    const link = `/roster?store_id=${encodeURIComponent(roster.store_id)}&week_start=${roster.week_start}`

    const lineFor = (sh) => `${dowOf(sh.work_date)} ${formatDayShort(sh.work_date)} · ${fmtTime(sh.start_at)}–${fmtTime(sh.end_at)}`

    for (const [staffId, list] of byStaff) {
      list.sort((a, b) => (a.work_date < b.work_date ? -1 : a.work_date > b.work_date ? 1 : a.start_at < b.start_at ? -1 : 1))
      await createNotification(db, {
        workspace_id: workspaceId,
        staff_id: staffId,
        type: isRepublish ? 'roster_republished' : 'roster_published',
        title: `Roster ${verb}: ${weekLabel}`,
        body: `${list.length} shift${list.length === 1 ? '' : 's'}${where}${actorName ? `, ${verb} by ${actorName}` : ''}. ${list.map(lineFor).join('; ')}.`,
        link,
        metadata: { roster_id: roster.id, week_start: roster.week_start, store_id: roster.store_id, version: roster.version, shift_count: list.length },
      })
    }

    const tg = await sendTelegramToStaff(db, workspaceId, [...byStaff.keys()], (staffId) => {
      const list = byStaff.get(staffId) || []
      return [
        `🗓 <b>Roster ${verb}: ${escapeHtml(weekLabel)}</b>${escapeHtml(where)}`,
        ...list.map((sh) => escapeHtml(lineFor(sh))),
        '',
        'Open FranHRM → Roster for the full week.',
      ].join('\n')
    })
    return { recipients: byStaff.size, telegram_sent: tg.sent }
  } catch (err) {
    console.error('[publish-notify] failed:', err?.message || err)
    return { recipients: 0, telegram_sent: 0 }
  }
}
