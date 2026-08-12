export default defineNuxtRouteMiddleware(async () => {
  const { staff, ready, refresh, isFinanceOrHq } = useSession()
  if (!ready.value) await refresh()
  if (!staff.value) return navigateTo('/login')
  if (!isFinanceOrHq.value) return navigateTo('/')
})
