import { randomBytes } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { compactStaff } from '../../../../core/staff/query.mjs'
import { recordAudit } from '../../../../core/audit/record.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:write' })
  const body = await readBody(event)
  const db = getAdminClient()

  const isDummy = !!body?.is_dummy
  // Codes are optional — we mint one (DUMMY-xxxx for simulated, EMP-xxxx for
  // real) when left blank, so adding a hire is one less field to fill.
  const rawCode = String(body?.employee_code || '').trim()
  const code = (rawCode || `${isDummy ? 'DUMMY' : 'EMP'}-${randomBytes(2).toString('hex').toUpperCase()}`).toUpperCase()
  const name = String(body?.display_name || '').trim()
  if (!name) throw apiError(400, 'display_name is required')

  const insert: Record<string, any> = {
    workspace_id: ctx.workspaceId,
    employee_code: code,
    display_name: name,
    is_dummy: isDummy,
    access_method: ['sso', 'otp', 'pin'].includes(body.access_method) ? body.access_method : 'pin',
    email: body.email ? String(body.email).toLowerCase().trim() : null,
    phone: body.phone || null,
    role: body.role || 'staff',
    employment_type: body.employment_type || 'full_time',
    home_store_id: body.home_store_id || null,
    hourly_rate_cents: body.hourly_rate_cents ?? null,
    pt_weekly_hour_cap: body.pt_weekly_hour_cap ?? null,
    pt_monthly_hour_cap: body.pt_monthly_hour_cap ?? null,
    hired_on: body.hired_on || null,
    // Statutory / CPF identity (SG). Mandatory-on-create is enforced by the
    // create flow, not here, so existing/dummy records stay valid.
    nric: body.nric ? String(body.nric).trim().toUpperCase() : null,
    date_of_birth: body.date_of_birth || null,
    postal_code: body.postal_code ? String(body.postal_code).trim() : null,
    unit_number: body.unit_number ? String(body.unit_number).trim() : null,
    // CPF / residency (for the CPF EZPay template).
    race: body.race || null,
    residency: ['citizen', 'pr', 'foreigner'].includes(body.residency) ? body.residency : null,
    cpf_applicable: body.cpf_applicable === undefined ? true : !!body.cpf_applicable,
    pr_start_date: body.pr_start_date || null,
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
