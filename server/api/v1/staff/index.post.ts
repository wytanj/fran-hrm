import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { compactStaff } from '../../../../core/staff/query.mjs'
import { recordAudit } from '../../../../core/audit/record.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const isDummy = !!body?.is_dummy
  // Dummies can skip the code — we mint a distinct DUMMY-xxxx one.
  const code = String(body?.employee_code || (isDummy ? `DUMMY-${randomBytes(2).toString('hex').toUpperCase()}` : '')).trim().toUpperCase()
  const name = String(body?.display_name || '').trim()
  if (!code || !name) throw apiError(400, 'employee_code and display_name are required')

  const insert: Record<string, any> = {
    workspace_id: ctx.workspaceId,
    employee_code: code,
    display_name: name,
    is_dummy: isDummy,
    email: body.email ? String(body.email).toLowerCase().trim() : null,
    phone: body.phone || null,
    role: body.role || 'staff',
    employment_type: body.employment_type || 'full_time',
    home_store_id: body.home_store_id || null,
    hourly_rate_cents: body.hourly_rate_cents ?? null,
    pt_weekly_hour_cap: body.pt_weekly_hour_cap ?? null,
    pt_monthly_hour_cap: body.pt_monthly_hour_cap ?? null,
    hired_on: body.hired_on || null,
  }
  // A dummy you can immediately sign in as, for E2E — default PIN unless given.
  if (isDummy && !body.pin) insert.pin_hash = bcrypt.hashSync('123456', 10)
  if (body.pin) {
    if (!/^\d{4,12}$/.test(String(body.pin))) throw apiError(400, 'PIN must be 4-12 digits')
    insert.pin_hash = bcrypt.hashSync(String(body.pin), 10)
  }

  const { data, error } = await db.from('staff').insert(insert).select().single()
  if (error) throw apiError(400, error.message)

  if (data.home_store_id) {
    await db.from('staff_store_assignments').insert({
      workspace_id: ctx.workspaceId, staff_id: data.id, store_id: data.home_store_id, is_primary: true,
    })
  }
  await recordAudit(db, {
    workspace_id: ctx.workspaceId, actor_kind: ctx.kind === 'api_key' ? 'agent' : 'user',
    actor_id: ctx.actorId, actor_name: ctx.actorName, source_type: ctx.sourceType,
    object_type: 'staff', entity_id: data.id, operation: 'INSERT', after_data: compactStaff(data),
  })
  return { data: compactStaff(data, { includeRate: true }) }
})
