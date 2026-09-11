// Telegram identity: which staff member is behind a telegram_user_id.
//
// Linking = employee_code + PIN, verified with bcrypt exactly like web login
// (core doctrine: one credential, one lockout counter). The bot never trusts
// a Telegram display name — only the link row created here. Every later bot
// action resolves the caller through resolveTelegramStaff() and then goes
// through the same core functions the web app uses, so scope and identity
// checks are identical on both surfaces.

import bcrypt from 'bcryptjs'
import { recordAudit } from '../audit/record.mjs'

const MAX_ATTEMPTS = 5
const LOCK_MINUTES = 15

function linkError(code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

/**
 * @param {object} db
 * @param {{ telegram_user_id: number, chat_id: number, username?: string|null,
 *           employee_code: string, pin: string }} input
 * @returns {Promise<{ staff: object, link: object, replaced: boolean }>}
 */
export async function linkTelegram(db, { telegram_user_id, chat_id, username = null, employee_code, pin }) {
  const tgId = Number(telegram_user_id)
  if (!Number.isFinite(tgId) || tgId <= 0) throw linkError('bad_request', 'Telegram user id missing from the update.')
  const code = String(employee_code || '').trim().toUpperCase()
  const pinStr = String(pin || '').trim()
  if (!code || !pinStr) throw linkError('bad_request', 'Send it as: /link <employee code> <PIN> — for example /link PT001 123456')

  const { data: staff, error } = await db.from('staff').select('*').eq('employee_code', code).maybeSingle()
  if (error) throw linkError('db', error.message)

  const fail = () => linkError('invalid', 'That employee code and PIN do not match. Use the same code and PIN you sign in to FranHRM with. If you have forgotten your PIN, ask your manager to reset it under Team → your profile.')
  if (!staff || staff.employment_status !== 'active' || !staff.pin_hash) throw fail()
  if (staff.locked_until && new Date(staff.locked_until) > new Date()) {
    throw linkError('locked', `Too many failed attempts — this account is locked for ${LOCK_MINUTES} minutes. Try again after that.`)
  }
  if (!bcrypt.compareSync(pinStr, staff.pin_hash)) {
    const attempts = (staff.failed_attempts || 0) + 1
    await db.from('staff').update({
      failed_attempts: attempts,
      locked_until: attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MINUTES * 60000).toISOString() : staff.locked_until,
    }).eq('id', staff.id)
    throw fail()
  }
  await db.from('staff').update({ failed_attempts: 0, locked_until: null }).eq('id', staff.id)

  // A Telegram account can only be one person. If it was linked to someone
  // else (shared phone, staff turnover) the old link is replaced and audited.
  const { data: existingByTg } = await db.from('staff_telegram_links')
    .select('staff_id, workspace_id').eq('telegram_user_id', tgId).maybeSingle()
  let replaced = false
  if (existingByTg && existingByTg.staff_id !== staff.id) {
    await db.from('staff_telegram_links').delete().eq('telegram_user_id', tgId)
    replaced = true
    await recordAudit(db, {
      workspace_id: existingByTg.workspace_id, actor_kind: 'user', actor_id: staff.id, actor_name: staff.display_name,
      source_type: 'api', object_type: 'staff_telegram_links', entity_id: existingByTg.staff_id, operation: 'DELETE',
      metadata: { reason: 'telegram_account_relinked_to_other_staff', telegram_user_id: tgId },
    })
  }

  const row = {
    workspace_id: staff.workspace_id,
    staff_id: staff.id,
    telegram_user_id: tgId,
    chat_id: Number(chat_id) || tgId,
    telegram_username: username ? String(username).slice(0, 64) : null,
    linked_at: new Date().toISOString(),
    last_seen_at: new Date().toISOString(),
  }
  const { data: link, error: upErr } = await db.from('staff_telegram_links')
    .upsert(row, { onConflict: 'staff_id' }).select().single()
  if (upErr) throw linkError('db', upErr.message)

  await recordAudit(db, {
    workspace_id: staff.workspace_id, actor_kind: 'user', actor_id: staff.id, actor_name: staff.display_name,
    source_type: 'api', object_type: 'staff_telegram_links', entity_id: staff.id, operation: 'INSERT',
    after_data: { telegram_user_id: tgId, telegram_username: row.telegram_username },
    metadata: { channel: 'telegram', replaced },
  })
  return { staff, link, replaced }
}

/** The staff row (plus link) for a Telegram user, or null when unlinked. */
export async function resolveTelegramStaff(db, telegramUserId) {
  const tgId = Number(telegramUserId)
  if (!Number.isFinite(tgId)) return null
  const { data, error } = await db.from('staff_telegram_links')
    .select('*, staff:staff_id(*)')
    .eq('telegram_user_id', tgId)
    .maybeSingle()
  if (error) {
    console.error('[telegram] resolve failed:', error.message)
    return null
  }
  if (!data?.staff || data.staff.employment_status !== 'active') return null
  db.from('staff_telegram_links').update({ last_seen_at: new Date().toISOString() })
    .eq('staff_id', data.staff_id).then(() => {}, () => {})
  return { staff: data.staff, link: { ...data, staff: undefined } }
}

export async function unlinkTelegram(db, telegramUserId) {
  const current = await resolveTelegramStaff(db, telegramUserId)
  if (!current) return false
  const { error } = await db.from('staff_telegram_links').delete().eq('staff_id', current.staff.id)
  if (error) throw new Error(error.message)
  await recordAudit(db, {
    workspace_id: current.staff.workspace_id, actor_kind: 'user', actor_id: current.staff.id,
    actor_name: current.staff.display_name, source_type: 'api',
    object_type: 'staff_telegram_links', entity_id: current.staff.id, operation: 'DELETE',
    metadata: { channel: 'telegram', reason: 'self_unlink' },
  })
  return true
}

/** Links for a set of staff in a workspace → Map(staff_id → { chat_id, telegram_username }). */
export async function listTelegramLinks(db, workspaceId, staffIds) {
  const ids = [...new Set((staffIds || []).filter(Boolean))]
  if (!ids.length) return new Map()
  const { data, error } = await db.from('staff_telegram_links')
    .select('staff_id, chat_id, telegram_user_id, telegram_username')
    .eq('workspace_id', workspaceId)
    .in('staff_id', ids)
  if (error) {
    // Missing table (032 not applied yet) must not break callers — nobody is linked.
    console.error('[telegram] listTelegramLinks failed:', error.message)
    return new Map()
  }
  return new Map((data || []).map((r) => [r.staff_id, r]))
}
