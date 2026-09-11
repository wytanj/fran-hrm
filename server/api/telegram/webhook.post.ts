import { handleUpdate } from '../../../core/telegram/handlers.mjs'

// Telegram webhook. Telegram POSTs one Update per request and retries on
// anything but a 2xx, so this always answers 200 — even when a handler
// fails — and never leaks an error body back to Telegram.
//
// Security: when TELEGRAM_WEBHOOK_SECRET is set, Telegram echoes it in the
// X-Telegram-Bot-Api-Secret-Token header (passed as secret_token to
// setWebhook — see docs/TELEGRAM_BOT_SETUP.md). A mismatch is a 401 so a
// spoofed update cannot drive the bot. Without the env var the endpoint is
// open, which is fine for a first local test and wrong for production.
export default defineEventHandler(async (event) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET || ''
  if (secret) {
    const got = getHeader(event, 'x-telegram-bot-api-secret-token') || ''
    if (got !== secret) {
      setResponseStatus(event, 401)
      return { ok: false, error: 'Bad or missing X-Telegram-Bot-Api-Secret-Token. Re-run setWebhook with the same secret_token as TELEGRAM_WEBHOOK_SECRET on Vercel.' }
    }
  }
  const update = await readBody(event).catch(() => null)
  if (!update || typeof update !== 'object') return { ok: true, ignored: true }
  try {
    const result = await handleUpdate(getAdminClient(), update)
    return { ok: true, handled: result?.handled ?? false, command: result?.command ?? null }
  } catch (err: any) {
    console.error('[telegram] webhook handler threw:', err?.message || err)
    return { ok: true, handled: false }
  }
})
