<template>
  <div v-if="staff">
    <UiPageHeader :eyebrow="`Welcome back, ${firstName}`" title="Dashboard"
      :subtitle="isSupervisor ? 'Store operations at a glance — approvals, coverage and hours.' : 'Your shifts, hours and requests.'" />

    <!-- Stat row -->
    <div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <UiStat label="My hours this week" :value="myHours" unit="h" :hint="`${myShifts.length} shift(s) scheduled`" />
      <UiStat label="Next shift" :value="nextShiftLabel" :hint="nextShiftHint" />
      <template v-if="isSupervisor">
        <UiStat label="Pending approvals" :value="pendingTotal"
          :tone="pendingTotal ? 'warning' : 'ink'"
          :hint="pendingTotal ? 'Leave, swaps and corrections' : 'Nothing waiting'" />
        <UiStat label="Open flags" :value="openFlags" :tone="openFlags ? 'warning' : 'ink'" hint="Lateness, no-shows, OT" />
      </template>
      <template v-else>
        <UiStat label="Leave remaining" :value="alRemaining" unit="d" hint="Annual leave this year" />
        <UiStat label="Clock status" :value="clockLabel" :tone="clockStatus?.open_entry ? 'success' : 'ink'"
          :hint="clockStatus?.shift ? `Shift ${fmtTime(clockStatus.shift.start_at)}–${fmtTime(clockStatus.shift.end_at)}` : 'No shift today'" />
      </template>
    </div>

    <div class="grid gap-6 lg:grid-cols-3">
      <!-- Today + my week -->
      <div class="lg:col-span-2">
        <div class="mb-5 rounded-lg border border-line-soft bg-white p-4 shadow-warm-sm">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p class="eyebrow">Today</p>
              <p v-if="clockStatus?.shift" class="mt-0.5 font-display text-[22px] font-bold leading-7 tabular-nums text-ink">
                {{ fmtTime(clockStatus.shift.start_at) }} – {{ fmtTime(clockStatus.shift.end_at) }}
              </p>
              <p v-else class="mt-0.5 text-[14px] text-muted">No published shift today.</p>
              <p v-if="clockStatus?.shift" class="text-[12px] text-muted">
                {{ clockStatus.shift.store?.name }} · {{ clockStatus.shift.break_minutes }} min break
              </p>
            </div>
            <div class="flex items-center gap-2">
              <UiBadge v-if="clockStatus?.on_break" tone="warning">On break</UiBadge>
              <UiBadge v-else-if="clockStatus?.open_entry" tone="success">In since {{ fmtTime(clockStatus.open_entry.clock_in_at) }}</UiBadge>
              <UiBadge v-else tone="muted">Not clocked in</UiBadge>
              <NuxtLink to="/clock"><UiButton size="sm">Open clock</UiButton></NuxtLink>
            </div>
          </div>
        </div>

        <div class="mb-2 flex items-center justify-between">
          <h2 class="font-display text-[18px] font-bold text-ink">My week</h2>
          <NuxtLink to="/roster" class="press text-[12.5px] font-semibold text-brown">Full roster →</NuxtLink>
        </div>
        <UiTable :columns="[
          { key: 'day', label: 'Day', width: '30%' },
          { key: 'time', label: 'Shift' },
          { key: 'break', label: 'Break', align: 'right' },
          { key: 'hours', label: 'Hours', align: 'right' },
        ]">
          <tr v-for="sh in myShifts" :key="sh.id" class="border-b border-line-soft last:border-0"
            :class="sh.work_date === today ? 'bg-yellow-soft/40' : ''">
            <td class="px-3.5 py-2.5">
              <span class="font-semibold text-ink">{{ fmtDow(sh.work_date) }}</span>
              <span class="ml-1.5 text-[12px] text-muted tabular-nums">{{ fmtShort(sh.work_date) }}</span>
              <UiBadge v-if="sh.work_date === today" tone="primary" class="ml-2">today</UiBadge>
            </td>
            <td class="px-3.5 py-2.5 tabular-nums">{{ fmtTime(sh.start_at) }} – {{ fmtTime(sh.end_at) }}</td>
            <td class="px-3.5 py-2.5 text-right tabular-nums text-muted">{{ sh.break_minutes }}m</td>
            <td class="px-3.5 py-2.5 text-right font-semibold tabular-nums">{{ netHours(sh) }}</td>
          </tr>
          <tr v-if="!myShifts.length">
            <td colspan="4" class="px-3.5 py-6 text-center text-[13px] text-muted">No shifts published for this week.</td>
          </tr>
        </UiTable>
      </div>

      <!-- Side column -->
      <div>
        <template v-if="isSupervisor && attention.length">
          <h2 class="mb-2 font-display text-[18px] font-bold text-ink">Needs you</h2>
          <div class="mb-5 overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
            <NuxtLink v-for="(a, i) in attention" :key="a.label" :to="a.to"
              class="press flex items-center gap-3 px-3.5 py-3" :class="i > 0 ? 'border-t border-line-soft' : ''">
              <span class="flex h-6 min-w-6 items-center justify-center rounded-full bg-warning-soft px-1.5 text-[11px] font-bold text-warning">
                {{ a.count }}
              </span>
              <span class="flex-1 text-[13px] text-ink">{{ a.label }}</span>
              <span class="text-line-strong">›</span>
            </NuxtLink>
          </div>
        </template>

        <h2 class="mb-2 font-display text-[18px] font-bold text-ink">Quick actions</h2>
        <div class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
          <NuxtLink v-for="(l, i) in quickLinks" :key="l.to" :to="l.to"
            class="press flex items-center gap-3 px-3.5 py-3" :class="i > 0 ? 'border-t border-line-soft' : ''">
            <span class="w-4 text-center text-[13px] text-muted">{{ l.icon }}</span>
            <span class="min-w-0 flex-1">
              <span class="block text-[13px] font-semibold text-ink">{{ l.label }}</span>
              <span class="block text-[11.5px] text-muted">{{ l.hint }}</span>
            </span>
            <span class="text-line-strong">›</span>
          </NuxtLink>
        </div>

        <div class="mt-5 rounded-lg border border-blue/30 bg-blue-soft p-4">
          <p class="text-[13px] font-semibold text-brown">Ask Claude</p>
          <p class="mt-1 text-[12px] leading-relaxed text-ink-soft">
            "How many hours did I work last month?" — connect once and Claude answers with your own permissions.
          </p>
          <NuxtLink to="/oauth/connect" class="press mt-2 inline-block text-[12px] font-semibold text-brown underline decoration-brown/30">
            Connect Claude →
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { staff, isSupervisor, isManager } = useSession()

const firstName = computed(() => staff.value?.display_name.split(' ')[0])
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const weekStart = mondayOf(today)

const { data: statusRes } = await useFetch<any>('/api/v1/clock/status')
const clockStatus = computed<any>(() => statusRes.value?.data)

const { data: shiftsRes } = await useFetch<any>('/api/v1/shifts', {
  query: { from: weekStart, to: addDays(weekStart, 6) },
})
const myShifts = computed<any[]>(() =>
  (shiftsRes.value?.data || [])
    .filter((s: any) => s.staff_id === staff.value?.id)
    .sort((a: any, b: any) => a.start_at.localeCompare(b.start_at)))

const myHours = computed(() => Math.round(myShifts.value.reduce((s, sh) => s + Number(netHours(sh)), 0) * 10) / 10)

const nextShift = computed(() => myShifts.value.find((s) => new Date(s.end_at) > new Date()))
const nextShiftLabel = computed(() => (nextShift.value ? fmtTime(nextShift.value.start_at) : '—'))
const nextShiftHint = computed(() =>
  nextShift.value
    ? `${fmtDow(nextShift.value.work_date)} ${fmtShort(nextShift.value.work_date)}`
    : 'Nothing upcoming this week')

const clockLabel = computed(() =>
  clockStatus.value?.on_break ? 'Break' : clockStatus.value?.open_entry ? 'In' : 'Out')

const { data: balancesRes } = await useFetch<any>('/api/v1/leave/balances', { default: () => ({ data: [] }) })
const alRemaining = computed(() => {
  const al = (balancesRes.value?.data || []).find((b: any) => b.leave_type === 'AL')
  return al ? al.remaining_days : 0
})

const { data: pendingSwaps } = await useFetch<any>('/api/v1/swaps', { query: { status: 'pending' }, server: false, default: () => ({ data: [] }) })
const { data: pendingLeave } = await useFetch<any>('/api/v1/leave/requests', { query: { status: 'pending' }, server: false, default: () => ({ data: [] }) })
const { data: pendingCorr } = await useFetch<any>('/api/v1/corrections', { query: { status: 'pending' }, server: false, default: () => ({ data: [] }) })
const { data: flagsRes } = await useFetch<any>('/api/v1/flags', {
  query: { status: 'open', from: addDays(today, -13), to: today }, server: false, default: () => ({ data: [] }),
})
const openFlags = computed(() => (flagsRes.value?.data || []).length)

const attention = computed(() => {
  if (!isSupervisor.value) return []
  const items: Array<{ label: string; to: string; count: number }> = []
  const leaveCount = (pendingLeave.value?.data || []).length
  const swapCount = (pendingSwaps.value?.data || []).length
  const corrCount = (pendingCorr.value?.data || []).length
  if (isManager.value && leaveCount) items.push({ label: 'Leave requests to approve', to: '/leave', count: leaveCount })
  if (swapCount) items.push({ label: 'Shift swaps to approve', to: '/swaps', count: swapCount })
  if (corrCount) items.push({ label: 'Timesheet corrections', to: '/reports', count: corrCount })
  if (openFlags.value) items.push({ label: 'Attendance flags to review', to: '/reports?tab=flags', count: openFlags.value })
  return items
})

const pendingTotal = computed(() => attention.value.reduce((s, a) => s + a.count, 0))

const quickLinks = computed(() => {
  const base = [
    { to: '/availability', label: 'Submit availability', hint: 'Tell your manager when you can work', icon: '◐' },
    { to: '/swaps', label: 'Request a shift swap', hint: 'Hand a shift to a teammate', icon: '⇄' },
    { to: '/leave', label: 'Apply for leave', hint: 'Annual, medical, unpaid', icon: '⌂' },
  ]
  if (isSupervisor.value) {
    base.unshift({ to: '/roster', label: 'Build next week\'s roster', hint: 'Draft, check guardrails, publish', icon: '▦' })
  }
  return base
})

function netHours(sh: any) {
  const h = (new Date(sh.end_at).getTime() - new Date(sh.start_at).getTime()) / 3600000 - (sh.break_minutes || 0) / 60
  return Math.round(h * 10) / 10
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })
}
function fmtDow(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-SG', { weekday: 'short', timeZone: 'UTC' })
}
function fmtShort(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
function mondayOf(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
</script>
