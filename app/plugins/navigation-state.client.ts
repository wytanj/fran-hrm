// Tracks the navigation currently in flight.
//
// Pages await their data in setup, so between the click and the render the
// route has not changed yet and the sidebar still highlights the old tab —
// which reads as "nothing happened". This exposes the pending destination so
// the nav can light up the tab you actually clicked, straight away.
export default defineNuxtPlugin((nuxtApp) => {
  const router = useRouter()
  const target = useState<string | null>('nav-target', () => null)

  router.beforeEach((to, from) => {
    target.value = to.fullPath === from.fullPath ? null : to.fullPath
  })
  router.afterEach(() => { target.value = null })
  router.onError(() => { target.value = null })

  // Belt and braces: if a page errors during setup, afterEach may not fire.
  nuxtApp.hook('page:finish', () => { target.value = null })
})
