// Session state: who is signed in, hydrated once per app load from
// /api/auth/me. Role helpers mirror the server's ROLE_LEVEL ordering.
const ROLE_LEVEL: Record<string, number> = {
  staff: 1, supervisor: 2, store_manager: 3, area_manager: 4, finance: 4, hq_admin: 5,
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
  is_dummy?: boolean
}

export function useSession() {
  const staff = useState<SessionStaff | null>('session-staff', () => null)
  const ready = useState<boolean>('session-ready', () => false)
  const viewingAs = useState<boolean>('session-viewing-as', () => false)

  async function refresh() {
    try {
      // useRequestFetch forwards the incoming request's cookies during SSR.
      // Plain $fetch does not, so the session check would fail server-side and
      // bounce an authenticated user to /login on every hard navigation.
      const res = await useRequestFetch()<{ ok: boolean; staff: SessionStaff | null; viewing_as?: boolean }>('/api/auth/me')
      staff.value = res.staff
      viewingAs.value = !!res.viewing_as
    } catch {
      staff.value = null
      viewingAs.value = false
    }
    ready.value = true
  }

  /** Swap the session to a dummy staff member, then hard-reload so every
   * page re-fetches under the new identity (SSR data already resolved under
   * the old one would otherwise go stale). */
  async function viewAs(staffId: string) {
    await $fetch(`/api/v1/staff/${staffId}/view-as`, { method: 'POST' })
    window.location.assign('/')
  }

  async function exitViewAs() {
    await $fetch('/api/v1/view-as/exit', { method: 'POST' })
    window.location.assign('/team')
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
  const isHqAdmin = computed(() => staff.value?.role === 'hq_admin')
  // Payroll is finance/HQ only — a specialist gate, not a seniority level (an
  // area_manager is senior but does not do financial processing).
  const isFinanceOrHq = computed(() => ['finance', 'hq_admin'].includes(staff.value?.role || ''))
  // staff:dummy in the default matrix — store_manager, area_manager, hq_admin.
  // The real gate is server-side; this only decides whether to show the
  // button, so a customised matrix can still diverge from this default.
  const canManageDummies = computed(() => ['store_manager', 'area_manager', 'hq_admin'].includes(staff.value?.role || ''))

  return {
    staff, ready, refresh, login, logout, isManager, isSupervisor, isAreaManager, isHqAdmin, isFinanceOrHq,
    canManageDummies, viewingAs, viewAs, exitViewAs,
  }
}
