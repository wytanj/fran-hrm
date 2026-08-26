// In-app notifications, shared by REST (and MCP, when a tool wants it).
// createNotification is a side-effect of some other mutation — failures are
// logged, never thrown, same doctrine as core/audit/record.mjs. Reads and
// explicit mark-read calls DO throw: those are the caller's actual request.

/**
 * @param {object} db Supabase client (service role)
 * @param {object} evt { workspace_id, staff_id, type, title, body, link, metadata }
 */
export async function createNotification(db, evt) {
  try {
    if (!evt?.workspace_id || !evt?.staff_id || !evt?.type || !evt?.title) {
      console.error('[notifications] insert skipped: workspace_id, staff_id, type and title are required')
      return
    }
    const { error } = await db.from('notifications').insert({
      workspace_id: evt.workspace_id,
      staff_id: evt.staff_id,
      type: evt.type,
      title: evt.title,
      body: evt.body ?? null,
      link: evt.link ?? null,
      metadata: evt.metadata || {},
    })
    if (error) console.error('[notifications] insert failed:', error.message)
  } catch (err) {
    console.error('[notifications] insert failed:', err?.message || err)
  }
}

/**
 * @param {object} db
 * @param {string} workspaceId
 * @param {string} staffId  recipient — always the caller's own staff_id at the route
 * @param {{ unreadOnly?: boolean, limit?: number }} [opts]
 */
export async function listNotifications(db, workspaceId, staffId, { unreadOnly = false, limit = 20 } = {}) {
  const cap = Math.min(Math.max(Number(limit) || 20, 1), 50)
  let q = db
    .from('notifications')
    .select('id, type, title, body, link, metadata, read_at, created_at')
    .eq('workspace_id', workspaceId)
    .eq('staff_id', staffId)
    .order('created_at', { ascending: false })
    .limit(cap)
  if (unreadOnly) q = q.is('read_at', null)

  const countQ = db
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('staff_id', staffId)
    .is('read_at', null)

  const [listRes, countRes] = await Promise.all([q, countQ])
  if (listRes.error) throw new Error(listRes.error.message)
  if (countRes.error) throw new Error(countRes.error.message)

  return {
    data: listRes.data || [],
    unread_count: countRes.count ?? 0,
  }
}

/**
 * Mark specific notifications read. Ids that do not belong to this
 * workspace + staff are silently ignored (the filters pin the row).
 */
export async function markRead(db, workspaceId, staffId, ids) {
  const unique = [...new Set((ids || []).map((id) => String(id || '').trim()).filter(Boolean))]
  if (!unique.length) return
  const { error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('staff_id', staffId)
    .in('id', unique)
    .is('read_at', null)
  if (error) throw new Error(error.message)
}

export async function markAllRead(db, workspaceId, staffId) {
  const { error } = await db
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('staff_id', staffId)
    .is('read_at', null)
  if (error) throw new Error(error.message)
}
