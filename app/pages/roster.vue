<template>
  <div>
    <UiPageHeader eyebrow="Scheduling" title="Roster"
      :subtitle="isManager ? 'Drafts are private to managers. Publishing makes the week live for staff and drives attendance comparison.' : undefined">
      <template #actions>
        <select v-if="stores.length > 1" v-model="storeId"
          class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px] font-medium">
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <div class="flex items-center gap-1 rounded-md border border-line bg-white">
          <button class="press h-9 w-8 text-brown" aria-label="Previous week" @click="shiftWeek(-7)">‹</button>
          <span class="min-w-[128px] px-1 text-center text-[12.5px] font-semibold tabular-nums">{{ weekLabel }}</span>
          <button class="press h-9 w-8 text-brown" aria-label="Next week" @click="shiftWeek(7)">›</button>
        </div>
        <button v-if="weekStart !== thisMonday" class="press h-9 rounded-md border border-line bg-white px-3 text-[12.5px] font-semibold text-brown" @click="weekStart = thisMonday">
          This week
        </button>
        <button class="no-print press h-9 rounded-md border border-line bg-white px-3 text-[12.5px] font-semibold text-brown" @click="print">
          Print
        </button>
      </template>
    </UiPageHeader>

    <!-- Status strip -->
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <UiBadge v-if="roster" :tone="roster.status === 'published' ? 'success' : 'warning'">
        {{ roster.status }}<span v-if="roster.version > 1"> · v{{ roster.version }}</span>
      </UiBadge>
      <UiBadge v-else tone="muted">no roster</UiBadge>
      <p v-if="roster" class="text-[12px] text-muted">
        {{ shifts.length }} shifts · {{ totalHours }}h scheduled · {{ assignedCount }} assigned
        <span v-if="openShiftCount" class="text-warning"> · {{ openShiftCount }} open</span>
      </p>
      <div v-if="isManager && roster" class="ml-auto flex items-center gap-2">
        <UiButton size="sm" variant="secondary" :loading="busy" @click="showAdd = !showAdd">
          {{ showAdd ? 'Close' : '+ Add shift' }}
        </UiButton>
        <UiButton size="sm" :variant="warnings.length ? 'secondary' : 'primary'" :loading="busy" @click="publish">
          {{ roster.status === 'draft' ? 'Publish' : 'Republish' }}{{ warnings.length ? ` (${warnings.length}⚠)` : '' }}
        </UiButton>
      </div>
    </div>

    <!-- Guardrails -->
    <div v-if="warnings.length && isManager" class="no-print mb-4 rounded-lg border border-warning/30 bg-warning-soft p-3.5">
      <p class="text-[12.5px] font-semibold text-warning">{{ warnings.length }} guardrail warning{{ warnings.length > 1 ? 's' : '' }} — review before publishing</p>
      <ul class="mt-1.5 space-y-0.5">
        <li v-for="(w, i) in warnings" :key="i" class="text-[12px] text-ink-soft">
          <span class="font-mono text-[10.5px] uppercase text-warning">{{ w.type }}</span> · {{ w.detail }}
        </li>
      </ul>
    </div>

    <!-- Add shift inline form -->
    <div v-if="showAdd && isManager && roster" class="no-print mb-4 rounded-lg border border-line bg-white p-4 shadow-warm-xs">
      <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Day</span>
          <select v-model="newShift.date" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
            <option v-for="d in days" :key="d.date" :value="d.date">{{ d.label }}</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Template</span>
          <select v-model="newShift.template_id" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
            <option v-for="t in templates" :key="t.id" :value="t.id">
              {{ t.name }} {{ t.start_time.slice(0, 5) }}–{{ t.end_time.slice(0, 5) }}
            </option>
          </select>
        </label>
        <label class="block lg:col-span-2">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Staff</span>
          <select v-model="newShift.staff_id" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
            <option value="">— open shift (PT pool) —</option>
            <option v-for="m in members" :key="m.id" :value="m.id">
              {{ m.display_name }} · {{ m.employment_type === 'part_time' ? 'PT' : 'FT' }}
            </option>
          </select>
        </label>
        <div class="flex items-end">
          <UiButton size="sm" class="w-full" :loading="busy" @click="addShift">Add</UiButton>
        </div>
      </div>
    </div>

    <!-- Empty state / draft creation -->
    <div v-if="!roster && !pending" class="rounded-lg border border-line-soft bg-white p-8 text-center shadow-warm-sm">
      <p class="font-display text-[19px] font-bold text-ink">No roster for {{ weekLabel }}</p>
      <p class="mx-auto mt-1 max-w-md text-[13px] text-muted">
        {{ isManager ? 'Start from scratch, or copy the previous week and adjust.' : "Your manager hasn't published this week yet." }}
      </p>
      <div v-if="isManager" class="mt-4 flex justify-center gap-2">
        <UiButton size="sm" :loading="busy" @click="createDraft(false)">Create empty draft</UiButton>
        <UiButton size="sm" variant="secondary" :loading="busy" @click="createDraft(true)">Copy last week</UiButton>
      </div>
    </div>

    <!-- ===== Desktop matrix: staff rows × day columns ===== -->
    <div v-else-if="roster" class="hidden overflow-x-auto rounded-lg border border-line-soft bg-white shadow-warm-sm md:block">
      <table class="w-full min-w-[900px] border-collapse text-left">
        <thead>
          <tr class="border-b border-line bg-surface-sunken/60">
            <th class="sticky left-0 z-10 bg-surface-sunken px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.5px] text-muted">Staff</th>
            <th v-for="d in days" :key="d.date"
              class="border-l border-line-soft px-2 py-2 text-center text-[10.5px] font-semibold uppercase tracking-[0.5px]"
              :class="d.date === today ? 'bg-yellow-soft text-brown' : 'text-muted'">
              {{ d.dow }}<span class="ml-1 font-normal normal-case tabular-nums">{{ d.dayNum }}</span>
            </th>
            <th class="border-l border-line px-3 py-2 text-right text-[10.5px] font-semibold uppercase tracking-[0.5px] text-muted">Hrs</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in matrix" :key="row.staff_id || 'open'" class="border-b border-line-soft last:border-0">
            <td class="sticky left-0 z-10 bg-white px-3.5 py-2">
              <p class="text-[13px] font-semibold text-ink">{{ row.name }}</p>
              <p class="text-[11px] text-muted">
                {{ row.employee_code }}<span v-if="row.type"> · {{ row.type === 'part_time' ? 'PT' : 'FT' }}</span>
                <span v-if="row.cap" class="text-muted"> · cap {{ row.cap }}h</span>
              </p>
            </td>
            <td v-for="d in days" :key="d.date"
              class="border-l border-line-soft px-1.5 py-1.5 align-top"
              :class="d.date === today ? 'bg-yellow-soft/30' : ''">
              <div v-for="sh in row.byDate[d.date] || []" :key="sh.id"
                class="group relative mb-1 rounded-[6px] px-2 py-1.5 text-center last:mb-0"
                :class="sh.staff_id ? 'bg-blue-soft' : 'border border-dashed border-warning/50 bg-warning-soft'">
                <p class="text-[11.5px] font-semibold leading-tight tabular-nums text-ink">
                  {{ fmtTime(sh.start_at) }}–{{ fmtTime(sh.end_at) }}
                </p>
                <p v-if="sh.job_code" class="text-[10px] leading-tight text-muted">{{ sh.job_code }}</p>
                <button v-if="isManager"
                  class="no-print press absolute -right-1 -top-1 hidden h-4 w-4 items-center justify-center rounded-full bg-danger text-[9px] font-bold text-white group-hover:flex"
                  aria-label="Remove shift" @click="removeShift(sh)">✕</button>
              </div>
              <p v-if="!(row.byDate[d.date] || []).length && row.staff_id" class="py-1 text-center text-[11px] text-line-strong">·</p>
            </td>
            <td class="border-l border-line px-3 py-2 text-right">
              <span class="text-[13px] font-semibold tabular-nums"
                :class="row.overCap || row.hours > 44 ? 'text-warning' : 'text-ink'">{{ row.hours }}</span>
            </td>
          </tr>
          <tr class="border-t border-line bg-surface-sunken/60">
            <td class="sticky left-0 z-10 bg-surface-sunken px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Cover</td>
            <td v-for="d in days" :key="d.date" class="border-l border-line-soft px-2 py-2 text-center text-[12px] font-semibold tabular-nums"
              :class="coverByDate[d.date] ? 'text-ink' : 'text-danger'">
              {{ coverByDate[d.date] || 0 }}
            </td>
            <td class="border-l border-line px-3 py-2 text-right text-[13px] font-bold tabular-nums text-ink">{{ totalHours }}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- ===== Mobile: day-by-day list ===== -->
    <div v-if="roster" class="space-y-3 md:hidden">
      <div v-for="d in days" :key="d.date">
        <p class="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">
          {{ d.label }}<span v-if="d.date === today" class="text-brown"> · today</span>
        </p>
        <div class="overflow-hidden rounded-lg border border-line-soft bg-white">
          <div v-for="(sh, i) in shiftsByDate[d.date] || []" :key="sh.id"
            class="flex items-center gap-3 px-3.5 py-2.5" :class="i > 0 ? 'border-t border-line-soft' : ''">
            <span class="w-[92px] shrink-0 text-[12.5px] font-semibold tabular-nums">{{ fmtTime(sh.start_at) }}–{{ fmtTime(sh.end_at) }}</span>
            <span class="flex-1 truncate text-[13px]" :class="sh.staff ? 'text-ink' : 'italic text-warning'">
              {{ sh.staff?.display_name || 'Open shift' }}
            </span>
            <button v-if="isManager" class="press text-[11px] text-danger" @click="removeShift(sh)">✕</button>
          </div>
          <p v-if="!(shiftsByDate[d.date] || []).length" class="px-3.5 py-2.5 text-[12.5px] text-muted">No shifts</p>
        </div>
      </div>
    </div>

    <p v-if="error" class="mt-3 text-[13px] text-danger">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
const { staff, isManager } = useSession()

const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const thisMonday = mondayOf(today)
const weekStart = ref(thisMonday)
const storeId = ref(staff.value?.home_store_id || '')
const error = ref('')
const busy = ref(false)
const showAdd = ref(false)

const { data: storesRes } = await useFetch<any>('/api/v1/stores')
const stores = computed<any[]>(() => (storesRes.value?.data || []).filter((s: any) => s.kind === 'store'))
if (!storeId.value && stores.value.length) storeId.value = stores.value[0].id

const { data: rosterRes, refresh, pending } = await useFetch<any>('/api/v1/rosters', {
  query: computed(() => ({ store_id: storeId.value, week_start: weekStart.value })),
  watch: [storeId, weekStart],
})
const roster = computed<any>(() => rosterRes.value?.data)
const shifts = computed<any[]>(() => roster.value?.shifts || [])

// Guardrails come from the detail route, which computes them server-side.
const { data: detailRes, refresh: refreshDetail } = await useFetch<any>(
  () => (roster.value ? `/api/v1/rosters/${roster.value.id}` : '/api/v1/templates'),
  { watch: [roster], immediate: true },
)
const warnings = computed<any[]>(() => detailRes.value?.warnings || [])

const { data: templatesRes } = await useFetch<any>('/api/v1/templates')
const templates = computed<any[]>(() => templatesRes.value?.data || [])

const { data: membersRes } = await useFetch<any>('/api/v1/staff', {
  query: { limit: 100, employment_status: 'active' }, server: false, default: () => ({ data: [] }),
})
const members = computed<any[]>(() => membersRes.value?.data || [])

const days = computed(() =>
  Array.from({ length: 7 }, (_, i) => {
    const date = addDays(weekStart.value, i)
    const d = new Date(`${date}T00:00:00Z`)
    return {
      date,
      dow: d.toLocaleDateString('en-SG', { weekday: 'short', timeZone: 'UTC' }),
      dayNum: date.slice(8),
      label: d.toLocaleDateString('en-SG', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' }),
    }
  }))

const shiftsByDate = computed(() => {
  const out: Record<string, any[]> = {}
  for (const sh of shifts.value) (out[sh.work_date] ||= []).push(sh)
  for (const k in out) out[k].sort((a, b) => a.start_at.localeCompare(b.start_at))
  return out
})

const coverByDate = computed(() => {
  const out: Record<string, number> = {}
  for (const sh of shifts.value) if (sh.staff_id) out[sh.work_date] = (out[sh.work_date] || 0) + 1
  return out
})

function netHours(sh: any) {
  return (new Date(sh.end_at).getTime() - new Date(sh.start_at).getTime()) / 3600000 - (sh.break_minutes || 0) / 60
}

/** One row per scheduled staff member, plus a row collecting open shifts. */
const matrix = computed(() => {
  const rows = new Map<string, any>()
  for (const sh of shifts.value) {
    const key = sh.staff_id || '__open__'
    if (!rows.has(key)) {
      const member = members.value.find((m) => m.id === sh.staff_id)
      rows.set(key, {
        staff_id: sh.staff_id,
        name: sh.staff?.display_name || 'Open shifts',
        employee_code: sh.staff?.employee_code || 'unassigned',
        type: member?.employment_type || null,
        cap: member?.pt_weekly_hour_cap || null,
        byDate: {} as Record<string, any[]>,
        hours: 0,
      })
    }
    const row = rows.get(key)
    ;(row.byDate[sh.work_date] ||= []).push(sh)
    row.hours += netHours(sh)
  }
  return [...rows.values()]
    .map((r) => ({
      ...r,
      hours: Math.round(r.hours * 10) / 10,
      overCap: r.cap ? r.hours > Number(r.cap) : false,
    }))
    .sort((a, b) => (a.staff_id ? 0 : 1) - (b.staff_id ? 0 : 1) || a.employee_code.localeCompare(b.employee_code))
})

const totalHours = computed(() => Math.round(shifts.value.reduce((s, sh) => s + netHours(sh), 0) * 10) / 10)
const assignedCount = computed(() => shifts.value.filter((s) => s.staff_id).length)
const openShiftCount = computed(() => shifts.value.filter((s) => !s.staff_id).length)

const weekLabel = computed(() => `${fmtShort(weekStart.value)} – ${fmtShort(addDays(weekStart.value, 6))}`)

const newShift = reactive({ date: '', template_id: '', staff_id: '' })
watch(days, () => { if (!newShift.date) newShift.date = days.value[0].date }, { immediate: true })
watch(templates, () => { if (!newShift.template_id && templates.value.length) newShift.template_id = templates.value[0].id }, { immediate: true })
watch(weekStart, () => { newShift.date = days.value[0].date })

function shiftWeek(n: number) { weekStart.value = addDays(weekStart.value, n) }

async function reloadAll() {
  await refresh()
  await refreshDetail()
}

async function createDraft(copy: boolean) {
  busy.value = true; error.value = ''
  try {
    await $fetch('/api/v1/rosters', {
      method: 'POST',
      body: {
        store_id: storeId.value,
        week_start: weekStart.value,
        copy_from_week: copy ? addDays(weekStart.value, -7) : undefined,
      },
    })
    await reloadAll()
  } catch (err: any) { error.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { busy.value = false }
}

async function addShift() {
  busy.value = true; error.value = ''
  try {
    await $fetch('/api/v1/shifts', {
      method: 'POST',
      body: {
        roster_id: roster.value.id,
        work_date: newShift.date,
        template_id: newShift.template_id,
        staff_id: newShift.staff_id || null,
      },
    })
    await reloadAll()
  } catch (err: any) { error.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { busy.value = false }
}

async function removeShift(sh: any) {
  busy.value = true; error.value = ''
  try {
    await $fetch(`/api/v1/shifts/${sh.id}`, { method: 'DELETE' })
    await reloadAll()
  } catch (err: any) { error.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { busy.value = false }
}

async function publish() {
  busy.value = true; error.value = ''
  try {
    await $fetch(`/api/v1/rosters/${roster.value.id}/publish`, {
      method: 'POST', body: { force: warnings.value.length > 0 },
    })
    await reloadAll()
  } catch (err: any) { error.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { busy.value = false }
}

function print() { window.print() }
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })
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
