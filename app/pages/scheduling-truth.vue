<template>
  <div>
    <UiPageHeader eyebrow="Scheduling" title="Scheduling truth"
      subtitle="One month, one answer: who must submit availability, who has, whether it is locked, and what has been published. Nothing here is guessed.">
      <template #actions>
        <select v-model="storeId" class="h-9 rounded-md border border-line bg-white px-2 text-[13px] text-ink focus:border-brown focus:outline-none">
          <option value="">All stores</option>
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} · {{ s.name }}</option>
        </select>
        <div class="flex items-center gap-1 rounded-md border border-line bg-white p-0.5">
          <button class="press rounded px-2 py-1 text-[13px] font-semibold text-brown" aria-label="Previous month" @click="month = shiftMonth(month, -1)">‹</button>
          <input v-model="month" type="month" class="h-7 border-0 bg-transparent px-1 text-[13px] font-semibold text-ink focus:outline-none">
          <button class="press rounded px-2 py-1 text-[13px] font-semibold text-brown" aria-label="Next month" @click="month = shiftMonth(month, 1)">›</button>
        </div>
        <UiButton v-if="canRemind" size="sm" variant="secondary" :loading="reminding" @click="sendReminders">Run today's reminders</UiButton>
      </template>
    </UiPageHeader>

    <UiBusy :busy="pending" label="Reading the month…">
      <div v-if="fetchErr" class="rounded-lg border border-danger/30 bg-danger-soft p-4 text-[13px] text-danger">{{ errorText(fetchErr) }}</div>
      <template v-else-if="obs">
        <!-- Window + headline -->
        <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <UiStat label="Availability window" :value="windowLabel" :hint="windowHint" :tone="obs.window.state === 'locked' ? 'warning' : obs.window.state === 'open' ? 'success' : 'ink'" />
          <UiStat label="Must submit" :value="obs.stats.required" :hint="`of ${obs.stats.people} active`" />
          <UiStat label="Submitted" :value="obs.stats.submitted" :tone="obs.stats.required && obs.stats.submitted === obs.stats.required ? 'success' : 'ink'" />
          <UiStat label="Missing" :value="obs.stats.missing" :tone="obs.stats.missing ? (obs.window.state === 'locked' ? 'danger' : 'warning') : 'success'" :hint="obs.window.state === 'locked' ? 'locked with nothing submitted' : ''" />
          <UiStat label="Telegram linked" :value="obs.stats.telegram_linked" :hint="`of ${obs.stats.required} required`" />
          <UiStat label="Published weeks" :value="`${obs.publish.weeks_published}/${obs.publish.weeks_total}`" :hint="obs.publish.open_shifts ? `${obs.publish.open_shifts} open shift(s) live` : `target ${obs.publish.target_date}`" :tone="obs.publish.weeks_published === obs.publish.weeks_total ? 'success' : 'ink'" />
        </div>

        <div class="mb-3 flex flex-wrap items-center gap-2">
          <button v-for="f in filters" :key="f.key" type="button"
            class="press rounded-md border px-2.5 py-1 text-[12px] font-semibold"
            :class="filter === f.key ? 'border-yellow-deep bg-yellow-soft text-brown' : 'border-line bg-white text-muted'"
            @click="filter = f.key">
            {{ f.label }} <span class="tabular-nums opacity-70">{{ f.count }}</span>
          </button>
          <span class="ml-auto text-[11.5px] text-muted">Rules v{{ rulesVersion }} · <NuxtLink to="/scheduling-rules" class="font-semibold text-brown underline decoration-brown/30">edit</NuxtLink></span>
        </div>

        <!-- People -->
        <UiTable :columns="[
          { key: 'who', label: 'Person' },
          { key: 'status', label: 'Availability', width: '150px' },
          { key: 'days', label: 'Days', align: 'right', width: '150px' },
          { key: 'lock', label: 'Lock', width: '130px' },
          { key: 'leave', label: 'Leave in month' },
          { key: 'tg', label: 'Telegram', width: '120px' },
          { key: 'shifts', label: 'Published shifts', align: 'right', width: '120px' },
        ]">
          <tr v-for="p in visibleStaff" :key="p.id" class="border-b border-line-soft last:border-0"
            :class="p.status === 'missing_locked' ? 'bg-danger-soft/40' : p.status === 'missing' ? 'bg-warning-soft/40' : ''">
            <td class="px-3.5 py-2.5">
              <NuxtLink :to="`/team/${p.id}`" class="font-semibold text-ink hover:underline">{{ p.display_name }}</NuxtLink>
              <UiDummyTag v-if="p.is_dummy" class="ml-1.5" />
              <p class="text-[11.5px] text-muted">
                {{ p.employee_code }} · {{ p.employment_type === 'part_time' ? 'PT' : p.employment_type === 'full_time' ? 'FT' : p.employment_type }}
                <template v-if="p.home_store && !storeId"> · {{ p.home_store.code }}</template>
              </p>
            </td>
            <td class="px-3.5 py-2.5">
              <UiBadge v-if="p.status === 'not_required'" tone="muted">not required</UiBadge>
              <UiBadge v-else-if="p.status === 'submitted'" tone="success">submitted</UiBadge>
              <UiBadge v-else-if="p.status === 'missing_locked'" tone="danger">missing · locked</UiBadge>
              <UiBadge v-else tone="warning">missing</UiBadge>
            </td>
            <td class="px-3.5 py-2.5 text-right tabular-nums text-[12.5px]">
              <template v-if="p.submitted_days">
                {{ p.submitted_days }} <span class="text-muted">({{ p.unavailable_days }} can't, {{ p.preferred_days }} prefer)</span>
              </template>
              <span v-else class="text-muted">—</span>
            </td>
            <td class="px-3.5 py-2.5">
              <UiBadge v-if="p.manager_locked_days" tone="warning">manager · {{ p.manager_locked_days }}d</UiBadge>
              <UiBadge v-else-if="p.window_locked && p.availability_required" tone="muted">rules lock</UiBadge>
              <span v-else class="text-[12px] text-muted">open</span>
            </td>
            <td class="px-3.5 py-2.5 text-[12.5px]">
              <template v-if="p.leave.length">
                <span v-for="l in p.leave" :key="l.id" class="mr-1.5 inline-flex items-center gap-1">
                  <UiBadge :tone="l.status === 'approved' ? 'accent' : 'muted'">{{ l.type }}</UiBadge>
                  <span class="tabular-nums text-ink-soft">{{ fmtSpan(l.start_date, l.end_date) }}</span>
                  <span v-if="l.status !== 'approved'" class="text-[10.5px] text-muted">({{ l.status }})</span>
                </span>
              </template>
              <span v-else class="text-muted">—</span>
            </td>
            <td class="px-3.5 py-2.5">
              <span v-if="p.telegram_linked" class="text-[12.5px] font-semibold text-success">linked<span v-if="p.telegram_username" class="font-normal text-muted"> @{{ p.telegram_username }}</span></span>
              <span v-else-if="p.availability_required" class="text-[12.5px] text-warning">not linked</span>
              <span v-else class="text-muted">—</span>
            </td>
            <td class="px-3.5 py-2.5 text-right tabular-nums">{{ p.published_shifts || '—' }}</td>
          </tr>
          <tr v-if="!visibleStaff.length">
            <td colspan="7" class="px-3.5 py-8 text-center text-[13px] text-muted">Nobody matches this filter.</td>
          </tr>
        </UiTable>

        <!-- Rosters -->
        <div class="mt-6 grid gap-5 lg:grid-cols-3">
          <section class="lg:col-span-2">
            <h2 class="mb-2 font-display text-[16px] font-bold text-ink">Roster weeks touching {{ monthLong }}</h2>
            <UiTable :columns="[
              { key: 'week', label: 'Week', width: '170px' },
              { key: 'store', label: 'Store' },
              { key: 'status', label: 'Status', width: '110px' },
              { key: 'shifts', label: 'Shifts', align: 'right', width: '90px' },
              { key: 'open', label: 'Open', align: 'right', width: '80px' },
              { key: 'hours', label: 'Hours', align: 'right', width: '90px' },
              { key: 'pub', label: 'Published', width: '150px' },
            ]">
              <template v-for="w in obs.rosters" :key="w.week_start">
                <tr v-if="!w.rosters.length" class="border-b border-line-soft last:border-0">
                  <td class="px-3.5 py-2.5 font-semibold tabular-nums text-ink">{{ fmtSpan(w.week_start, w.week_end) }}</td>
                  <td class="px-3.5 py-2.5 text-muted" colspan="6">No roster yet.
                    <NuxtLink to="/roster-builder" class="font-semibold text-brown underline decoration-brown/30">Build / import →</NuxtLink>
                  </td>
                </tr>
                <tr v-for="(r, i) in w.rosters" :key="r.id" class="border-b border-line-soft last:border-0">
                  <td class="px-3.5 py-2.5 font-semibold tabular-nums text-ink">{{ i === 0 ? fmtSpan(w.week_start, w.week_end) : '' }}</td>
                  <td class="px-3.5 py-2.5 text-[12.5px]">{{ r.store?.code }} · {{ r.store?.name }}</td>
                  <td class="px-3.5 py-2.5">
                    <UiBadge :tone="r.status === 'published' ? 'success' : 'warning'">{{ r.status }}<span v-if="r.status === 'published' && r.version > 1"> v{{ r.version }}</span></UiBadge>
                  </td>
                  <td class="px-3.5 py-2.5 text-right tabular-nums">{{ r.shifts }}</td>
                  <td class="px-3.5 py-2.5 text-right tabular-nums" :class="r.open_shifts ? 'font-semibold text-warning' : ''">{{ r.open_shifts || '—' }}</td>
                  <td class="px-3.5 py-2.5 text-right tabular-nums">{{ r.hours }}</td>
                  <td class="px-3.5 py-2.5 text-[12px] text-muted">{{ r.published_at ? fmtWhen(r.published_at) : '—' }}</td>
                </tr>
              </template>
            </UiTable>
          </section>

          <section>
            <h2 class="mb-2 font-display text-[16px] font-bold text-ink">Leave in {{ monthLong }}</h2>
            <div class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-xs">
              <div v-for="l in obs.leave" :key="l.id" class="flex items-center gap-2 border-b border-line-soft px-3.5 py-2 last:border-0">
                <UiBadge :tone="l.status === 'approved' ? 'accent' : 'muted'">{{ l.type }}</UiBadge>
                <span class="flex-1 truncate text-[12.5px] font-semibold text-ink">{{ l.display_name }}</span>
                <span class="text-[12px] tabular-nums text-muted">{{ fmtSpan(l.start_date, l.end_date) }}</span>
              </div>
              <p v-if="!obs.leave.length" class="px-3.5 py-6 text-center text-[12.5px] text-muted">No approved or pending leave.</p>
            </div>
            <p class="mt-2 text-[11.5px] leading-relaxed text-muted">
              Approved leave is a hard block in the roster generator and a guardrail at publish. It is shown here so a missing
              availability is not mistaken for a free person.
            </p>

            <div class="mt-4 rounded-lg border border-blue/30 bg-blue-soft p-4">
              <p class="text-[13px] font-semibold text-brown">Reading this panel</p>
              <ul class="mt-1.5 space-y-1 text-[12px] leading-relaxed text-ink-soft">
                <li><strong>Missing</strong> — must submit, has nothing for the month. Nudge via Telegram or run reminders.</li>
                <li><strong>Missing · locked</strong> — the window closed with nothing in. They will be scheduled as available.</li>
                <li><strong>Rules lock</strong> — after day {{ lockDay }} of the prior month (edit on Scheduling rules). <strong>Manager</strong> lock is per-date, set on Roster builder.</li>
                <li><strong>Open</strong> shifts on a published week are unfilled slots staff can see.</li>
              </ul>
            </div>
          </section>
        </div>

        <p v-if="message" class="mt-3 text-[12.5px]" :class="messageTone === 'error' ? 'text-danger' : 'text-success'">{{ message }}</p>
      </template>
    </UiBusy>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['supervisor-only'] })

const route = useRoute()
const { staff } = useSession()

function shiftMonth(m: string, n: number) {
  const [y, mo] = m.split('-').map(Number)
  const total = y * 12 + (mo - 1) + n
  return `${Math.floor(total / 12)}-${String((((total % 12) + 12) % 12) + 1).padStart(2, '0')}`
}
const initialMonth = typeof route.query.month === 'string' && /^\d{4}-\d{2}$/.test(route.query.month)
  ? route.query.month
  : shiftMonth(todaySG().slice(0, 7), 1)
const month = ref(initialMonth)
const storeId = ref(typeof route.query.store_id === 'string' ? route.query.store_id : '')
const filter = ref<'all' | 'missing' | 'submitted' | 'unlinked' | 'not_required'>('all')

const { data: storesRes } = await useFetch<any>('/api/v1/stores', { default: () => ({ data: [] }), lazy: true })
const stores = computed<any[]>(() => storesRes.value?.data || [])

const { data: res, pending, error: fetchErr, refresh } = await useFetch<any>('/api/v1/scheduling/observation', {
  query: computed(() => ({ month: month.value, store_id: storeId.value || undefined })),
  watch: [month, storeId],
})
const obs = computed(() => res.value?.data || null)
const rulesVersion = computed(() => res.value?.rules_version)
const lockDay = computed(() => obs.value?.window?.lock_date?.slice(8) ? Number(obs.value.window.lock_date.slice(8)) : '')

const filters = computed(() => {
  const s: any[] = obs.value?.staff || []
  return [
    { key: 'all', label: 'Everyone', count: s.length },
    { key: 'missing', label: 'Missing', count: s.filter((p) => p.status === 'missing' || p.status === 'missing_locked').length },
    { key: 'submitted', label: 'Submitted', count: s.filter((p) => p.status === 'submitted').length },
    { key: 'unlinked', label: 'No Telegram', count: s.filter((p) => p.availability_required && !p.telegram_linked).length },
    { key: 'not_required', label: 'Not required', count: s.filter((p) => p.status === 'not_required').length },
  ]
})
const visibleStaff = computed<any[]>(() => {
  const s: any[] = obs.value?.staff || []
  const order = { missing_locked: 0, missing: 1, submitted: 2, not_required: 3 } as Record<string, number>
  const sorted = [...s].sort((a, b) => (order[a.status] - order[b.status]) || a.employee_code.localeCompare(b.employee_code))
  if (filter.value === 'missing') return sorted.filter((p) => p.status === 'missing' || p.status === 'missing_locked')
  if (filter.value === 'submitted') return sorted.filter((p) => p.status === 'submitted')
  if (filter.value === 'unlinked') return sorted.filter((p) => p.availability_required && !p.telegram_linked)
  if (filter.value === 'not_required') return sorted.filter((p) => p.status === 'not_required')
  return sorted
})

// Reminders button is for roster:write holders; the server enforces it.
const canRemind = computed(() => ['supervisor', 'store_manager', 'area_manager', 'hq_admin'].includes(staff.value?.role || ''))
const reminding = ref(false)
const message = ref('')
const messageTone = ref<'ok' | 'error'>('ok')

async function sendReminders() {
  reminding.value = true; message.value = ''
  try {
    const r: any = await $fetch('/api/v1/scheduling/reminders/run', { method: 'POST', body: {} })
    const ws = r?.workspaces?.[0]
    messageTone.value = 'ok'
    message.value = ws?.due?.length
      ? `Sent ${ws.sent} in-app (${ws.telegram_sent} via Telegram), ${ws.skipped_duplicate} already sent today. Due: ${ws.due.map((d: any) => `${d.token} for ${d.month}`).join(', ')}.`
      : 'Nothing is due today under the current rules (reminders fire on the open day, the T-n days, and the first locked day).'
    if (ws?.warnings?.length) message.value += ` ${ws.warnings.join(' ')}`
    await refresh()
  } catch (err: any) {
    messageTone.value = 'error'; message.value = errorText(err)
  } finally { reminding.value = false }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const monthLong = computed(() => `${MONTHS[Number(month.value.slice(5, 7)) - 1]} ${month.value.slice(0, 4)}`)
const windowLabel = computed(() => {
  const w = obs.value?.window
  if (!w) return '—'
  return w.state === 'open' ? 'Open' : w.state === 'locked' ? 'Locked' : 'Not yet open'
})
const windowHint = computed(() => {
  const w = obs.value?.window
  if (!w) return ''
  if (w.state === 'upcoming') return `opens ${fmtDay(w.open_date)}, closes ${fmtDay(w.lock_date)}`
  if (w.state === 'open') return `closes end of ${fmtDay(w.lock_date)} · ${w.days_until_lock}d left`
  return `closed ${fmtDay(w.lock_date)} · publish by ${fmtDay(w.publish_target_date)}`
})

function fmtDay(d: string) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
function fmtSpan(a: string, b: string) {
  return a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`
}
function fmtWhen(iso: string) {
  return new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })
}
function errorText(err: any) {
  return err?.data?.message || err?.data?.statusMessage || err?.message || 'Something went wrong'
}
</script>
