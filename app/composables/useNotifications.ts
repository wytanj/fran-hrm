// App-wide in-app notification inbox. Shared via useState so the topbar
// badge and the dropdown read the same list without each page re-fetching.
// Polls on an interval and refreshes on navigation; no websocket.

export interface AppNotification {
  id: string
  type: string
  title: string
  body?: string | null
  link?: string | null
  metadata?: Record<string, unknown>
  read_at?: string | null
  created_at: string
}

export function useNotifications() {
  const items = useState<AppNotification[]>('notif-items', () => [])
  const unreadCount = useState<number>('notif-unread', () => 0)
  const ready = useState<boolean>('notif-ready', () => false)

  async function refresh() {
    try {
      // useRequestFetch forwards cookies during SSR; plain $fetch drops them
      // and would 401 an authenticated hard-nav. Client-side $fetch is fine.
      const fetcher = import.meta.server ? useRequestFetch() : $fetch
      const res = await fetcher<{ data: AppNotification[]; unread_count: number }>('/api/v1/notifications')
      items.value = res.data || []
      unreadCount.value = res.unread_count || 0
    } catch {
      // Keep whatever we last had — a badge flicker to zero on a blip is worse.
    }
    ready.value = true
  }

  async function markRead(ids: string[]) {
    if (!ids.length) return
    const now = new Date().toISOString()
    const set = new Set(ids)
    for (const n of items.value) {
      if (set.has(n.id) && !n.read_at) n.read_at = now
    }
    unreadCount.value = items.value.filter((n) => !n.read_at).length
    try {
      await $fetch('/api/v1/notifications/read', { method: 'POST', body: { ids } })
    } catch {
      await refresh()
    }
  }

  async function markAllRead() {
    const now = new Date().toISOString()
    for (const n of items.value) {
      if (!n.read_at) n.read_at = now
    }
    unreadCount.value = 0
    try {
      await $fetch('/api/v1/notifications/read', { method: 'POST', body: {} })
    } catch {
      await refresh()
    }
  }

  return { items, unreadCount, ready, refresh, markRead, markAllRead }
}
