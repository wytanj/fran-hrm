// Append-only audit writer shared by REST routes and MCP tools.
// Audit failures are logged, never thrown — a mutation must not roll back
// because the audit insert failed (same doctrine as fran-skums).

/**
 * @param {object} db Supabase client (service role)
 * @param {object} evt { workspace_id, actor_kind, actor_id, actor_name,
 *   source_type, object_type, entity_id, operation, before_data, after_data, metadata }
 */
export async function recordAudit(db, evt) {
  try {
    const { error } = await db.from('audit_events').insert({
      workspace_id: evt.workspace_id,
      actor_kind: evt.actor_kind || 'user',
      actor_id: evt.actor_id || null,
      actor_name: evt.actor_name || null,
      source_type: evt.source_type || 'web',
      object_type: evt.object_type,
      entity_id: evt.entity_id || null,
      operation: evt.operation || 'UPDATE',
      before_data: evt.before_data ?? null,
      after_data: evt.after_data ?? null,
      metadata: evt.metadata || {},
    })
    if (error) console.error('[audit] insert failed:', error.message)
  } catch (err) {
    console.error('[audit] insert failed:', err?.message || err)
  }
}
