// Session state: who is signed in, hydrated once per app load from
// /api/auth/me. Role helpers mirror the server's ROLE_LEVEL ordering.
const ROLE_LEVEL: Record<string, number> = {
  staff: 1, supervisor: 2, store_manager: 3, area_manager: 4, hq_admin: 5,
}

export interface SessionStaff {
  id: string
  employee_code: string
  display_name: string
  email?: string
  role: string
  employment_type: string
  home_store_id?: string
  home_store?: { id: string; code: string; name: string } | null
}

export function useSession() {
  const staff = useState<SessionStaff | null>('session-staff', () => null)
  const ready = useState<boolean>('session-ready', () => false)

  async function refresh() {
    try {
      // useRequestFetch forwards the incoming request's cookies during SSR.
      // Plain $fetch does not, so the session check would fail server-side and
      // bounce an authenticated user to /login on every hard navigation.
      const res = await useRequestFetch()<{ ok: boolean; staff: SessionStaff | null }>('/api/auth/me')
      staff.value = res.staff
    } catch {
      staff.value = null
    }
    ready.value = true
  }

  async function login(identifier: string, pin: string) {
    const res = await $fetch<{ ok: boolean; staff: SessionStaff }>('/api/auth/login', {
      method: 'POST',
      body: { identifier, pin },
    })
    staff.value = res.staff
    await refresh()
    return res.staff
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    staff.value = null
    navigateTo('/login')
  }

  const isManager = computed(() => (ROLE_LEVEL[staff.value?.role || ''] || 0) >= ROLE_LEVEL.store_manager)
  const isSupervisor = computed(() => (ROLE_LEVEL[staff.value?.role || ''] || 0) >= ROLE_LEVEL.supervisor)
  const isAreaManager = computed(() => (ROLE_LEVEL[staff.value?.role || ''] || 0) >= ROLE_LEVEL.area_manager)

  return { staff, ready, refresh, login, logout, isManager, isSupervisor, isAreaManager }
}
