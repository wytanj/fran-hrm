export default defineEventHandler(async (event) => {
  await logoutStaff(event)
  return { ok: true }
})
