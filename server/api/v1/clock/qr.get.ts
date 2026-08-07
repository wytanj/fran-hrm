import { randomBytes } from 'node:crypto'
import QRCode from 'qrcode'
import { sgToday } from '../../../utils/dates'

// Daily rotating QR per store (get-or-create). Supervisor+ displays this at
// the counter; staff scan it to clock in/out. Yesterday's code is useless —
// the token is bound to (store, SGT date).
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'attendance:write' })
  const q = getQuery(event)
  const storeId = String(q.store_id || '')
  if (!storeId) throw apiError(400, 'store_id is required')
  const db = getAdminClient()

  const { data: store } = await db
    .from('stores').select('id, code, name').eq('workspace_id', ctx.workspaceId).eq('id', storeId).maybeSingle()
  if (!store) throw apiError(404, 'Store not found')

  const today = sgToday()
  let { data: row } = await db
    .from('qr_tokens').select('*').eq('store_id', storeId).eq('valid_on', today).maybeSingle()
  if (!row) {
    const token = `hrmqr_${randomBytes(18).toString('base64url')}`
    const inserted = await db.from('qr_tokens')
      .insert({ workspace_id: ctx.workspaceId, store_id: storeId, valid_on: today, token })
      .select().maybeSingle()
    // Unique race on (store, date): re-read if another request won.
    row = inserted.data || (await db.from('qr_tokens').select('*').eq('store_id', storeId).eq('valid_on', today).maybeSingle()).data
  }
  if (!row) throw apiError(500, 'Could not create QR token')

  const svg = await QRCode.toString(row.token, { type: 'svg', margin: 1, width: 320 })
  return { data: { token: row.token, valid_on: row.valid_on, store: { id: store.id, code: store.code, name: store.name }, svg } }
})
