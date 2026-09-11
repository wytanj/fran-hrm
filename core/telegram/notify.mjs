// Deliver a message to staff over Telegram when (and only when) they have
// linked. Pairs with core/notifications/record.mjs: the in-app notification
// is the durable record, the Telegram DM is the nudge. Never throws.

import { listTelegramLinks } from './identity.mjs'
import { sendMessage } from './client.mjs'

/**
 * @param {object} db
 * @param {string} workspaceId
 * @param {string[]} staffIds
 * @param {(staffId: string, link: object) => string} textFor  HTML message per person
 * @returns {Promise<{ linked: number, sent: number }>}
 */
export async function sendTelegramToStaff(db, workspaceId, staffIds, textFor) {
  const links = await listTelegramLinks(db, workspaceId, staffIds)
  let sent = 0
  for (const [staffId, link] of links) {
    try {
      const text = textFor(staffId, link)
      if (!text) continue
      const res = await sendMessage(link.chat_id, text)
      if (res?.ok) sent += 1
    } catch (err) {
      console.error('[telegram] send to staff failed:', err?.message || err)
    }
  }
  return { linked: links.size, sent }
}
