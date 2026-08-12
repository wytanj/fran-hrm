export default defineNuxtRouteMiddleware(async () => {
  const { staff, ready, refresh, isHqAdmin } = useSession()
  if (!ready.value) await refresh()
  if (!staff.value) return navigateTo('/login')
  if (!isHqAdmin.value) return navigateTo('/')
})
