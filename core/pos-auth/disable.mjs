import { recordPosAuthEvent } from './audit.mjs'

export async function disablePosAccess(db, {
  workspaceId,
  staff,
  actor,
  storeCode = null,
  detail = {},
}) {
  const now = new Date().toISOString()
  const { error } = await db.from('staff').update({
    pos_access_enabled: false,
    pin_hash: null,
    pin_expires_at: null,
    pin_rotated_at: now,
    failed_attempts: 0,
    locked_until: null,
    updated_at: now,
  }).eq('workspace_id', workspaceId).eq('id', staff.id)
  if (error) throw new Error(error.message)

  await db.from('staff_sessions')
    .update({ ended_at: now })
    .eq('staff_id', staff.id)
    .is('ended_at', null)

  await recordPosAuthEvent(db, {
    workspace_id: workspaceId,
    event_type: 'disable',
    staff_id: staff.id,
    employee_code: staff.employee_code,
    actor_staff_id: actor?.staff_id || null,
    actor_name: actor?.name || null,
    store_code: storeCode,
    detail,
  })
}
