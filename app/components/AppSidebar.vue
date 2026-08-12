<template>
  <!-- Desktop: fixed rail. Mobile: slide-over drawer behind a scrim. -->
  <div
    v-if="open"
    class="fixed inset-0 z-30 bg-brown/40 lg:hidden"
    @click="$emit('close')"
  />
  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r border-line bg-white transition-transform lg:translate-x-0"
    :class="open ? 'translate-x-0' : '-translate-x-full'"
  >
    <div class="flex h-14 shrink-0 items-center gap-2 border-b border-line-soft px-4">
      <span class="flex h-7 w-7 items-center justify-center rounded-md bg-yellow text-[13px] font-bold text-brown">F</span>
      <span class="font-display text-[19px] font-bold tracking-tight text-ink">FranHRM</span>
      <button class="press ml-auto text-muted lg:hidden" aria-label="Close menu" @click="$emit('close')">✕</button>
    </div>

    <nav class="flex-1 overflow-y-auto px-2.5 py-3">
      <template v-for="group in groups" :key="group.label">
        <p v-if="group.items.length" class="px-2.5 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[1px] text-muted">
          {{ group.label }}
        </p>
        <NuxtLink
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="press mb-0.5 flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13.5px] font-medium"
          :class="isActive(item.to) || isNavigatingTo(item.to)
            ? 'bg-yellow-soft font-semibold text-brown'
            : 'text-ink-soft hover:bg-surface-sunken'"
          @click="$emit('close')"
        >
          <span class="w-4 text-center text-[13px]">
            <!-- Swap the icon for a spinner on the tab being opened, so the
                 click is acknowledged before the page renders. -->
            <UiSpinner v-if="isNavigatingTo(item.to)" size="xs" />
            <template v-else>{{ item.icon }}</template>
          </span>
          <span class="flex-1">{{ item.label }}</span>
          <span
            v-if="item.count && !isNavigatingTo(item.to)"
            class="rounded-full bg-brown px-1.5 py-0.5 text-[10px] font-bold text-yellow"
          >{{ item.count }}</span>
        </NuxtLink>
      </template>
    </nav>

    <div class="shrink-0 border-t border-line-soft p-2.5">
      <NuxtLink
        to="/more"
        class="press flex items-center gap-2.5 rounded-md px-2.5 py-2 hover:bg-surface-sunken"
        @click="$emit('close')"
      >
        <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-peach-soft text-[11px] font-bold text-brown">
          {{ initials }}
        </span>
        <span class="min-w-0 flex-1">
          <span class="block truncate text-[13px] font-semibold text-ink">{{ staff?.display_name }}</span>
          <span class="block truncate text-[11px] text-muted">{{ roleLabel }}</span>
        </span>
      </NuxtLink>
    </div>
  </aside>
</template>

<script setup lang="ts">
defineProps<{ open: boolean }>()
defineEmits(['close'])

const route = useRoute()
const { staff, isSupervisor, isManager, isAreaManager, isHqAdmin, isFinanceOrHq } = useSession()
const { isNavigatingTo } = useNavigating()

// Pending-approval counts drive the sidebar badges — the point of a desk tool
// is seeing what needs you without hunting for it.
const { data: swaps } = await useFetch<any>('/api/v1/swaps', { query: { status: 'pending' }, server: false, default: () => ({ data: [] }) })
const { data: leave } = await useFetch<any>('/api/v1/leave/requests', { query: { status: 'pending' }, server: false, default: () => ({ data: [] }) })
const { data: corrections } = await useFetch<any>('/api/v1/corrections', { query: { status: 'pending' }, server: false, default: () => ({ data: [] }) })

const pendingSwaps = computed(() => (swaps.value?.data || []).length)
const pendingLeave = computed(() => (leave.value?.data || []).length)
const pendingCorrections = computed(() => (corrections.value?.data || []).length)

const groups = computed(() => [
  {
    label: 'Overview',
    items: [
      { to: '/', label: 'Dashboard', icon: '◫' },
      { to: '/clock', label: 'Clock', icon: '◷' },
      { to: '/payslips', label: 'My payslips', icon: '$' },
    ],
  },
  {
    label: 'Scheduling',
    items: [
      { to: '/roster', label: 'Roster', icon: '▦' },
      ...(isSupervisor.value ? [{ to: '/roster-builder', label: 'Build / import', icon: '✧' }] : []),
      { to: '/availability', label: 'Availability', icon: '◐' },
      { to: '/swaps', label: 'Shift swaps', icon: '⇄', count: isSupervisor.value ? pendingSwaps.value : 0 },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/leave', label: 'Leave', icon: '⌂', count: isManager.value ? pendingLeave.value : 0 },
      { to: '/org', label: 'Org & accountability', icon: '⌗' },
      ...(isSupervisor.value ? [{ to: '/team', label: 'Team', icon: '⚇' }] : []),
    ],
  },
  ...(isSupervisor.value
    ? [{
        label: 'Manage',
        items: [
          { to: '/clock-scan', label: 'Check-in scanner', icon: '⧉' },
          { to: '/zones', label: 'Store zones', icon: '▧' },
          { to: '/reports', label: 'Timesheets', icon: '▤', count: pendingCorrections.value },
          { to: '/reports?tab=hours', label: 'Reports', icon: '◲' },
          ...(isFinanceOrHq.value ? [{ to: '/payroll', label: 'Payroll', icon: '◎' }] : []),
          { to: '/permissions', label: 'Permissions', icon: '⚿' },
          ...(isHqAdmin.value ? [{ to: '/connect-claude', label: 'Connect Claude', icon: '✦' }] : []),
        ],
      }]
    : []),
  {
    label: 'Support',
    items: [{ to: '/help', label: 'Help centre', icon: '?' }],
  },
])

const initials = computed(() =>
  staff.value?.display_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase())

const roleLabel = computed(() => ({
  staff: 'Staff', supervisor: 'Supervisor', store_manager: 'Store Manager',
  area_manager: 'Area Manager', hq_admin: 'HQ Admin',
}[staff.value?.role || ''] || staff.value?.role))

function isActive(to: string) {
  const path = to.split('?')[0]
  if (path === '/') return route.path === '/'
  // A query-scoped entry (Reports) only lights up when its tab is the active one.
  if (to.includes('?')) return route.fullPath === to
  return route.path === path || route.path.startsWith(`${path}/`)
}
</script>
