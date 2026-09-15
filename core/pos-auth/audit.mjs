export async function recordPosAuthEvent(db, row) {
  const { error } = await db.from('pos_auth_events').insert({
    workspace_id: row.workspace_id,
    event_type: row.event_type,
    staff_id: row.staff_id || null,
    employee_code: row.employee_code || null,
    actor_staff_id: row.actor_staff_id || null,
    actor_name: row.actor_name || null,
    store_code: row.store_code || null,
    register_id: row.register_id || null,
    device_token: row.device_token || null,
    detail: row.detail || {},
  })
  if (error) throw new Error(error.message)
}
