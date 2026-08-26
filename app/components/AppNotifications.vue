<template>
  <div ref="root" class="relative">
    <button
      type="button"
      class="press relative flex h-9 w-9 items-center justify-center rounded-md text-brown hover:bg-surface-sunken"
      :aria-label="unreadCount ? `Notifications, ${unreadCount} unread` : 'Notifications'"
      :aria-expanded="open"
      aria-haspopup="dialog"
      @click="toggle"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M18 8A6 6 0 1 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M13.73 21a2 2 0 0 1-3.46 0" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span
        v-if="unreadCount"
        class="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-yellow px-1 text-[9px] font-bold tabular-nums text-brown"
      >{{ unreadCount > 99 ? '99+' : unreadCount }}</span>
    </button>

    <div
      v-if="open"
      class="absolute right-0 z-40 mt-1 w-[360px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-lg border border-line bg-white shadow-warm-md"
      role="dialog"
      aria-label="Notifications"
    >
      <div class="flex items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
        <p class="font-display text-[14px] font-bold text-ink">Notifications</p>
        <span v-if="unreadCount" class="text-[11.5px] text-muted">{{ unreadCount }} unread</span>
        <button
          v-if="unreadCount"
          type="button"
          class="press ml-auto text-[12px] font-semibold text-brown"
          @click="markAllRead"
        >Mark all read</button>
      </div>

      <div v-if="!items.length" class="px-3.5 py-6 text-center text-[12.5px] text-muted">
        No notifications yet.
      </div>
      <ul v-else class="max-h-80 overflow-y-auto divide-y divide-line-soft">
        <li v-for="n in items" :key="n.id">
          <NuxtLink
            :to="n.link || route.path"
            class="press flex gap-2.5 px-3.5 py-2.5 hover:bg-surface-sunken"
            :class="n.read_at ? '' : 'bg-yellow-soft/35'"
            @click="onItemClick(n)"
          >
            <span
              class="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
              :class="n.read_at ? 'bg-transparent' : 'bg-yellow'"
              aria-hidden="true"
            />
            <div class="min-w-0 flex-1">
              <p class="text-[12.5px] font-semibold text-ink">{{ n.title }}</p>
              <p v-if="n.body" class="mt-0.5 text-[12px] leading-snug text-ink-soft">{{ n.body }}</p>
              <p class="mt-0.5 text-[11px] text-muted">{{ relativeTime(n.created_at) }}</p>
            </div>
          </NuxtLink>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
const { items, unreadCount, refresh, markRead, markAllRead } = useNotifications()
const route = useRoute()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
let pollId: number | undefined

onMounted(() => {
  refresh()
  pollId = window.setInterval(() => {
    if (document.hidden) return
    refresh()
  }, 60_000)
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onUnmounted(() => {
  if (pollId) window.clearInterval(pollId)
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

watch(() => route.fullPath, () => {
  open.value = false
})

function toggle() {
  open.value = !open.value
}

function onDocClick(e: MouseEvent) {
  if (!open.value) return
  if (root.value && !root.value.contains(e.target as Node)) open.value = false
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') open.value = false
}

function onItemClick(n: { id: string; read_at?: string | null }) {
  if (!n.read_at) markRead([n.id])
  open.value = false
}

function relativeTime(iso: string) {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.round((Date.now() - t) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`
  return new Date(iso).toLocaleDateString('en-SG', {
    day: 'numeric', month: 'short', timeZone: 'Asia/Singapore',
  })
}
</script>
