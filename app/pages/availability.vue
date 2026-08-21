<template>
  <div>
    <UiPageHeader eyebrow="Scheduling" title="Availability"
      :subtitle="`Tell your manager when you can work. Changes lock ${cutoffDays} days ahead so the roster can be planned.`">
      <template #actions>
        <div class="flex items-center gap-1 rounded-md border border-line bg-white">
          <button class="press h-9 w-8 text-brown disabled:opacity-40" :disabled="pending" aria-label="Previous week" @click="shiftWeek(-7)">‹</button>
          <span class="flex min-w-[128px] items-center justify-center gap-1.5 px-1 text-center text-[12.5px] font-semibold tabular-nums">
            <UiSpinner v-if="pending" size="xs" />
            {{ weekLabel }}
          </span>
          <button class="press h-9 w-8 text-brown disabled:opacity-40" :disabled="pending" aria-label="Next week" @click="shiftWeek(7)">›</button>
        </div>
        <UiButton size="sm" :loading="saving" @click="save">Submit availability</UiButton>
      </template>
    </UiPageHeader>

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="lg:col-span-2">
        <UiTable :columns="[
          { key: 'day', label: 'Day', width: '150px' },
          { key: 'pref', label: 'Preference' },
          { key: 'window', label: 'Time window', width: '220px' },
          { key: 'locked', label: '', align: 'right', width: '120px' },
        ]">
          <tr v-for="day in days" :key="day.date" class="border-b border-line-soft last:border-0"
            :class="day.locked ? 'bg-surface-sunken/60' : ''">
            <td class="px-3.5 py-2.5">
              <span class="font-semibold text-ink">{{ day.dow }}</span>
              <span class="ml-1.5 text-[12px] tabular-nums text-muted">{{ day.dayNum }} {{ day.month }}</span>
            </td>
            <td class="px-3.5 py-2">
              <div class="flex gap-1">
                <button v-for="k in kinds" :key="k.key" type="button" :disabled="day.locked"
                  class="press rounded-md border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-40"
                  :class="day.kind === k.key ? k.active : 'border-line bg-white text-muted'"
                  @click="day.kind = k.key">
                  {{ k.label }}
                </button>
              </div>
            </td>
            <td class="px-3.5 py-2">
              <div v-if="day.kind !== 'unavailable'" class="flex items-center gap-1.5">
                <input v-model="day.start" type="time" :disabled="day.locked"
                  class="h-8 rounded-md border border-line bg-white px-2 text-[12.5px] disabled:opacity-40">
                <span class="text-[11.5px] text-muted">to</span>
                <input v-model="day.end" type="time" :disabled="day.locked"
                  class="h-8 rounded-md border border-line bg-white px-2 text-[12.5px] disabled:opacity-40">
              </div>
              <span v-else class="text-[12.5px] text-muted">—</span>
            </td>
            <td class="px-3.5 py-2.5 text-right">
              <template v-if="day.managerLock">
                <UiBadge tone="warning" :title="managerLockHint(day)">locked</UiBadge>
                <p class="mt-0.5 text-[10.5px] text-muted">{{ managerLockBy(day) }}</p>
              </template>
              <UiBadge v-else-if="day.locked" tone="muted">locked</UiBadge>
              <UiBadge v-else-if="day.submitted" tone="success">saved</UiBadge>
            </td>
          </tr>
        </UiTable>

        <div class="mt-3 flex items-center gap-3">
          <UiButton size="sm" :loading="saving" @click="save">Submit availability</UiButton>
          <button class="press text-[12.5px] font-semibold text-muted" @click="setAll('available')">Mark all available</button>
          <button class="press text-[12.5px] font-semibold text-muted" @click="setAll('unavailable')">Mark all unavailable</button>
          <p v-if="message" class="text-[12.5px]" :class="messageTone === 'error' ? 'text-danger' : 'text-success'">{{ message }}</p>
        </div>
      </div>

      <div>
        <div class="rounded-lg border border-blue/30 bg-blue-soft p-4">
          <p class="text-[13px] font-semibold text-brown">How this is used</p>
          <ul class="mt-1.5 space-y-1 text-[12px] leading-relaxed text-ink-soft">
            <li><strong>Can work</strong> — you're available if needed.</li>
            <li><strong>Prefer</strong> — you'd like this shift; managers favour these.</li>
            <li><strong>Can't</strong> — you're not available at all.</li>
          </ul>
          <p class="mt-2 text-[11.5px] text-ink-soft">
            Part-timers are scheduled from this pool. Submitting nothing makes you less likely to be scheduled.
          </p>
        </div>

        <div v-if="myShifts.length" class="mt-4 overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-xs">
          <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">
            Already scheduled this week
          </p>
          <div v-for="s in myShifts" :key="s.id" class="flex items-center gap-2 border-b border-line-soft px-3.5 py-2 last:border-0">
            <span class="text-[12.5px] font-semibold tabular-nums">{{ fmtDow(s.work_date) }}</span>
            <span class="flex-1 text-[12.5px] tabular-nums text-muted">{{ fmtTime(s.start_at) }}–{{ fmtTime(s.end_at) }}</span>
          </div>
        </div>

        <NuxtLink to="/help/availability-and-swaps" class="press mt-3 block text-[12px] font-semibold text-brown underline decoration-brown/30">
          Availability rules →
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const cutoffDays = 7
const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const cutoffDate = addDays(today, cutoffDays)
const weekStart = ref(addDays(mondayOf(today), 7)) // opens on next week

const kinds = [
  { key: 'available', label: 'Can work', active: 'border-success/40 bg-success-soft text-success' },
  { key: 'preferred', label: 'Prefer', active: 'border-yellow-deep bg-yellow-soft text-brown' },
  { key: 'unavailable', label: "Can't", active: 'border-danger/40 bg-danger-soft text-danger' },
]

interface DayRow {
  date: string; dow: string; dayNum: string; month: string
  kind: string; start: string; end: string; locked: boolean; submitted: boolean
  managerLock: { locked_at?: string; locked_by?: { display_name?: string; employee_code?: string } | null } | null
}
const days = ref<DayRow[]>([])

const { data: availRes, refresh, pending } = await useFetch<any>('/api/v1/availability', {
  query: computed(() => ({ from: weekStart.value, to: addDays(weekStart.value, 6) })),
  watch: [weekStart], lazy: true,
})

const { data: shiftsRes } = await useFetch<any>('/api/v1/shifts', {
  query: computed(() => ({ from: weekStart.value, to: addDays(weekStart.value, 6) })),
  watch: [weekStart], default: () => ({ data: [] }), lazy: true,
})
const { staff } = useSession()
const myShifts = computed<any[]>(() =>
  (shiftsRes.value?.data || []).filter((s: any) => s.staff_id === staff.value?.id))

watch([weekStart, availRes], () => {
  const existing: any[] = availRes.value?.data || []
  const locks: any[] = availRes.value?.locks || []
  days.value = Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart.value, i)
    const row = existing.find((a) => a.work_date === date)
    const managerLock = locks.find((l) => l.work_date === date) || null
    const d = new Date(`${date}T00:00:00Z`)
    return {
      date,
      dow: d.toLocaleDateString('en-SG', { weekday: 'long', timeZone: 'UTC' }),
      dayNum: date.slice(8),
      month: d.toLocaleDateString('en-SG', { month: 'short', timeZone: 'UTC' }),
      kind: row?.kind || 'available',
      start: row?.start_time?.slice(0, 5) || '10:00',
      end: row?.end_time?.slice(0, 5) || '21:30',
      locked: date < cutoffDate || Boolean(managerLock),
      submitted: Boolean(row),
      managerLock,
    }
  })
}, { immediate: true })

const weekLabel = computed(() => `${fmtShort(weekStart.value)} – ${fmtShort(addDays(weekStart.value, 6))}`)

const saving = ref(false)
const message = ref('')
const messageTone = ref<'ok' | 'error'>('ok')

function setAll(kind: string) {
  for (const d of days.value) if (!d.locked) d.kind = kind
}

async function save() {
  saving.value = true; message.value = ''
  const editable = days.value.filter((d) => !d.locked)
  if (!editable.length) {
    messageTone.value = 'error'
    message.value = days.value.some((d) => d.managerLock)
      ? 'Every day in this week is locked. Ask your manager to unlock a date if you need to change it.'
      : 'Every day in this week is past the cutoff.'
    saving.value = false
    return
  }
  try {
    await $fetch('/api/v1/availability', {
      method: 'POST',
      body: {
        entries: editable.map((d) => ({
          work_date: d.date,
          kind: d.kind,
          start_time: d.kind === 'unavailable' ? null : d.start,
          end_time: d.kind === 'unavailable' ? null : d.end,
        })),
      },
    })
    messageTone.value = 'ok'
    message.value = `Saved ${editable.length} day(s).`
    await refresh()
  } catch (err: any) {
    messageTone.value = 'error'
    message.value = err?.data?.message || err?.data?.statusMessage || 'Failed to save'
  } finally { saving.value = false }
}

function managerLockBy(day: DayRow) {
  return day.managerLock?.locked_by?.display_name || 'Manager'
}
function managerLockHint(day: DayRow) {
  const name = managerLockBy(day)
  const at = day.managerLock?.locked_at
    ? new Date(day.managerLock.locked_at).toLocaleString('en-SG', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: 'Asia/Singapore',
    })
    : null
  return at
    ? `Locked by ${name} on ${at} while the roster is being built. Ask them to unlock it if you need to change this day.`
    : `Locked by ${name} while the roster is being built. Ask them to unlock it if you need to change this day.`
}
function shiftWeek(n: number) { weekStart.value = addDays(weekStart.value, n) }
function fmtShort(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-SG', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
function fmtDow(date: string) {
  return new Date(`${date}T00:00:00Z`).toLocaleDateString('en-SG', { weekday: 'short', timeZone: 'UTC' })
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })
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
