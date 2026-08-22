export default defineEventHandler(async (event) => {
  const staff = await getSessionStaff(event)
  if (!staff) return { ok: false, staff: null }
  const db = getAdminClient()
  const { data: store } = staff.home_store_id
    ? await db.from('stores').select('id, code, name').eq('id', staff.home_store_id).maybeSingle()
    : { data: null }
  return {
    ok: true,
    staff: {
      id: staff.id,
      employee_code: staff.employee_code,
      display_name: staff.display_name,
      email: staff.email,
      role: staff.role,
      employment_type: staff.employment_type,
      home_store_id: staff.home_store_id,
      home_store: store,
      is_dummy: staff.is_dummy,
    },
    viewing_as: isViewingAs(event),
  }
})
