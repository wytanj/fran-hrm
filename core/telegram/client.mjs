// Thin Telegram Bot API client. Reads TELEGRAM_BOT_TOKEN from the
// environment; when it is missing every send is a no-op that returns
// { ok: false, skipped: 'no_token' } and logs once, so the rest of the
// pipeline (in-app notifications, audit) keeps working before J T has
// created the bot. Never throws on a delivery failure — a Telegram outage
// must not roll back an availability submit.

const API = 'https://api.telegram.org'
let warnedNoToken = false

export function telegramToken() {
  return process.env.TELEGRAM_BOT_TOKEN || ''
}

export function isTelegramConfigured() {
  return Boolean(telegramToken())
}

/**
 * Call any Bot API method. Returns the parsed JSON ({ ok, result | description }).
 * @param {string} method e.g. 'sendMessage'
 * @param {object} payload JSON body
 */
export async function telegramCall(method, payload = {}, { fetchImpl = globalThis.fetch } = {}) {
  const token = telegramToken()
  if (!token) {
    if (!warnedNoToken) {
      warnedNoToken = true
      console.warn('[telegram] TELEGRAM_BOT_TOKEN is not set — Telegram sends are skipped. Add it in Vercel → Settings → Environment Variables and redeploy (see docs/TELEGRAM_BOT_SETUP.md).')
    }
    return { ok: false, skipped: 'no_token' }
  }
  try {
    const res = await fetchImpl(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => ({ ok: false, description: `HTTP ${res.status}` }))
    if (!json.ok) console.error(`[telegram] ${method} failed:`, json.description || res.status)
    return json
  } catch (err) {
    console.error(`[telegram] ${method} threw:`, err?.message || err)
    return { ok: false, description: err?.message || String(err) }
  }
}

/**
 * Send a text message. Defaults to HTML parse mode — escape user-supplied
 * text with escapeHtml() before interpolating.
 */
export async function sendMessage(chatId, text, { parseMode = 'HTML', replyMarkup = null, disablePreview = true } = {}) {
  if (!chatId || !text) return { ok: false, skipped: 'empty' }
  const payload = { chat_id: chatId, text: String(text).slice(0, 4000), parse_mode: parseMode, disable_web_page_preview: disablePreview }
  if (replyMarkup) payload.reply_markup = replyMarkup
  return telegramCall('sendMessage', payload)
}

export async function answerCallbackQuery(callbackQueryId, text = '') {
  if (!callbackQueryId) return { ok: false, skipped: 'empty' }
  return telegramCall('answerCallbackQuery', { callback_query_id: callbackQueryId, text: text ? String(text).slice(0, 200) : undefined })
}

/** Best-effort delete (used to scrub a PIN out of the chat after /link). */
export async function deleteMessage(chatId, messageId) {
  if (!chatId || !messageId) return { ok: false, skipped: 'empty' }
  return telegramCall('deleteMessage', { chat_id: chatId, message_id: messageId })
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
