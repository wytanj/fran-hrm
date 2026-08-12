// Public routes. /oauth/authorize handles its own login bounce so the full
// authorize query survives the round trip — a blanket redirect here would
// drop client_id/code_challenge/state and break the Claude flow.
const PUBLIC = ['/login', '/auth/confirm', '/oauth/authorize', '/oauth/connect']

export default defineNuxtRouteMiddleware(async (to) => {
  if (PUBLIC.includes(to.path)) return
  const { staff, ready, refresh } = useSession()
  if (!ready.value) await refresh()
  if (!staff.value) {
    return navigateTo(`/login?redirect=${encodeURIComponent(to.fullPath)}`)
  }
})
