export default defineNuxtRouteMiddleware(async () => {
  const { staff, ready, refresh, isSupervisor } = useSession()
  if (!ready.value) await refresh()
  if (!staff.value) return navigateTo('/login')
  if (!isSupervisor.value) return navigateTo('/')
})
