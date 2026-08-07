export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const staff = await loginStaff(event, body?.identifier, body?.pin)
  return {
    ok: true,
    staff: {
      id: staff.id,
      employee_code: staff.employee_code,
      display_name: staff.display_name,
      role: staff.role,
      employment_type: staff.employment_type,
      home_store_id: staff.home_store_id,
    },
  }
})
