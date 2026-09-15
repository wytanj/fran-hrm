import { disablePosAccess } from '../../../../core/pos-auth/disable.mjs'
import { roleAtLeast } from '../../../utils/scopes'

function canDisable(ctx: any) {
  return ctx.has('pos:disable') || ctx.has('staff:write') || ctx.has('leave:approve')
}

async function assertStoreScope(db: any, ctx: any, staff: any, storeCode: string | null) {
  if (ctx.kind === 'api_key') return
  if (!ctx.staff) return
  if (roleAtLeast(ctx.staff.role, 'area_manager')) return
  // Store managers: target must share home store or assignment with actor.
  const actorStore = ctx.staff.home_store_id
  if (!actorStore) {
    throw apiError(403, 'Store manager has no home store — cannot scope disable')
  }
  if (staff.home_store_id === actorStore) return
  const { data: assigns } = await db
    .from('staff_store_assignments')
    .select('store_id')
    .eq('staff_id', staff.id)
    .eq('store_id', actorStore)
    .maybeSingle()
  if (assigns) return
  if (storeCode) {
    const { data: store } = await db.from('stores').select('id, code').eq('workspace_id', ctx.workspaceId).eq('code', storeCode).maybeSingle()
    if (store && store.id === actorStore) {
      // still need staff on that store
      throw apiError(403, 'Staff is not assigned to your store')
    }
  }
  throw apiError(403, 'Staff is outside your store scope')
}

/**
 * Theft / exit disable with confirm. Bot or SM/area/HQ session.
 * Body: { staff_id|employee_code, confirm: true, store_code? }
 */
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event)
  if (!canDisable(ctx)) {
    throw apiError(403, 'Requires pos:disable, staff:write, or leave:approve')
  }

  const body = await readBody(event)
  if (body?.confirm !== true && body?.confirm !== 'true') {
    throw apiError(400, 'confirm must be true — enum confirm only')
  }

  const db = getAdminClient()
  const ref = body?.staff_id || body?.employee_code || body?.employeeCode
  if (!ref) throw apiError(400, 'staff_id or employee_code required')

  let q = db.from('staff').select('*').eq('workspace_id', ctx.workspaceId)
  q = String(ref).includes('-') && String(ref).length > 30
    ? q.eq('id', ref)
    : q.eq('employee_code', String(ref).trim().toUpperCase())
  const { data: staff, error } = await q.maybeSingle()
  if (error) throw apiError(500, error.message)
  if (!staff) throw apiError(404, 'Staff not found')

  await assertStoreScope(db, ctx, staff, body?.store_code || body?.storeCode || null)

  await disablePosAccess(db, {
    workspaceId: ctx.workspaceId,
    staff,
    actor: {
      staff_id: ctx.kind === 'session' ? ctx.staff?.id : null,
      name: ctx.actorName,
    },
    storeCode: body?.store_code || body?.storeCode || null,
    detail: { via: 'pos_disable_api' },
  })

  return {
    ok: true,
    disabled: {
      staff_id: staff.id,
      employee_code: staff.employee_code,
      pos_access_enabled: false,
    },
  }
})
