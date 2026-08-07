// fran-pos staff-directory pull. POS calls this with its pos_connector API
// key and upserts each row via its upsert_pos_staff_from_source RPC — the
// roster-sync contract defined in fran-pos migration 00004. Field names
// below map 1:1 onto that RPC's parameters:
//   source_provider='fran-hrm', external_subject_id = staff.id.
// Termination/inactivation propagates employment_status so POS auto-revokes
// register access (POS never auto-re-enables — local POS authority).
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'pos:sync' })
  const db = getAdminClient()
  const q = getQuery(event)

  let query = db
    .from('staff')
    .select('id, employee_code, display_name, email, phone, role, employment_type, employment_status, pos_access_enabled, updated_at, home_store:home_store_id(code, name)')
    .eq('workspace_id', ctx.workspaceId)
    .order('employee_code')
  if (q.updated_since) query = query.gte('updated_at', String(q.updated_since))
  const { data, error } = await query
  if (error) throw apiError(500, error.message)

  const roleMap: Record<string, string> = {
    hq_admin: 'admin',
    area_manager: 'admin',
    store_manager: 'manager',
    supervisor: 'manager',
    staff: 'cashier',
  }

  return {
    source_provider: 'fran-hrm',
    generated_at: new Date().toISOString(),
    data: (data || []).map((s: any) => ({
      external_subject_id: s.id,
      external_user_id: s.employee_code,
      display_name: s.display_name,
      email: s.email,
      phone: s.phone,
      role: roleMap[s.role] || 'cashier',
      employment_status: s.employment_status,
      employment_type: s.employment_type === 'part_time' ? 'part-time' : 'full-time',
      pos_access_enabled: s.pos_access_enabled,
      home_store_code: s.home_store?.code || null,
      source_updated_at: s.updated_at,
    })),
  }
})
