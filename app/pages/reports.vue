<template>
  <div>
    <UiPageHeader eyebrow="Manager tools" title="Timesheets & reports"
      subtitle="Scheduled versus actual, overtime, adherence flags and payroll periods.">
      <template #actions>
        <input v-model="from" type="date" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px]">
        <span class="text-[12px] text-muted">to</span>
        <input v-model="to" type="date" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px]">
        <select v-model="storeId" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px] font-medium">
          <option value="">All stores</option>
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <a class="press inline-flex h-9 items-center rounded-md bg-yellow px-3 text-[12.5px] font-semibold text-brown shadow-glow"
          :href="exportUrl" download>Export CSV</a>
      </template>
    </UiPageHeader>

    <!-- Tabs -->
    <div class="mb-5 flex gap-1 border-b border-line">
      <button v-for="t in tabs" :key="t.key" type="button"
        class="press -mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold"
        :class="tab === t.key ? 'border-yellow-deep text-ink' : 'border-transparent text-muted hover:text-ink-soft'"
        @click="tab = t.key">
        {{ t.label }}
        <span v-if="t.count" class="ml-1.5 rounded-full bg-warning-soft px-1.5 text-[10px] font-bold text-warning">{{ t.count }}</span>
      </button>
    </div>

    <!-- ===== HOURS ===== -->
    <template v-if="tab === 'hours'">
      <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UiStat label="Staff worked" :value="summary?.staff_count || 0" />
        <UiStat label="Total hours" :value="totalHours" unit="h" />
        <UiStat label="Weekly OT" :value="totalOt" unit="h" :tone="totalOt > 0 ? 'warning' : 'ink'" hint="Past 44h/week" />
        <UiStat v-if="isAreaManager" label="Est. manpower cost"
          :value="summary?.estimated_total_cost_cents ? `$${(summary.estimated_total_cost_cents / 100).toFixed(0)}` : '—'"
          hint="Rate × hours, indicative" />
        <UiStat v-else label="Incomplete entries" :value="incomplete" :tone="incomplete ? 'warning' : 'ink'" hint="Missing clock-out" />
      </div>

      <UiTable :columns="hoursColumns">
        <tr v-for="r in summary?.rows || []" :key="r.staff_id" class="border-b border-line-soft last:border-0 hover:bg-surface-sunken/50">
          <td class="px-3.5 py-2.5">
            <span class="font-semibold text-ink">{{ r.display_name }}</span>
            <span class="ml-1.5 text-[11.5px] text-muted">{{ r.employee_code }}</span>
          </td>
          <td class="px-3.5 py-2.5">
            <UiBadge :tone="r.employment_type === 'part_time' ? 'accent' : 'muted'">
              {{ r.employment_type === 'part_time' ? 'PT' : 'FT' }}
            </UiBadge>
          </td>
          <td class="px-3.5 py-2.5 text-right font-semibold tabular-nums">{{ r.total_hours }}</td>
          <td class="px-3.5 py-2.5 text-right tabular-nums text-muted">{{ r.days_worked }}</td>
          <td class="px-3.5 py-2.5 text-right tabular-nums" :class="r.weekly_ot_hours ? 'font-semibold text-warning' : 'text-muted'">
            {{ r.weekly_ot_hours || '—' }}
          </td>
          <td class="px-3.5 py-2.5 text-right tabular-nums" :class="r.incomplete_entries ? 'text-warning' : 'text-muted'">
            {{ r.incomplete_entries || '—' }}
          </td>
          <td class="px-3.5 py-2.5 text-right">
            <span v-if="flagSum(r)" class="text-[12px] text-warning">{{ flagLabel(r) }}</span>
            <span v-else class="text-muted">—</span>
          </td>
          <td v-if="isAreaManager" class="px-3.5 py-2.5 text-right tabular-nums">
            {{ r.estimated_cost_cents ? `$${(r.estimated_cost_cents / 100).toFixed(2)}` : '—' }}
          </td>
        </tr>
        <tr v-if="!(summary?.rows || []).length">
          <td :colspan="hoursColumns.length" class="px-3.5 py-8 text-center text-[13px] text-muted">
            No time entries in this period.
          </td>
        </tr>
      </UiTable>
      <p class="mt-2 text-[11.5px] text-muted">
        Hours are net of breaks. Overtime is flagged for review, never auto-paid — see
        <NuxtLink to="/help/overtime-and-hours" class="font-semibold text-brown underline decoration-brown/30">how hours are calculated</NuxtLink>.
      </p>
    </template>

    <!-- ===== FLAGS ===== -->
    <template v-if="tab === 'flags'">
      <UiTable :columns="[
        { key: 'type', label: 'Flag', width: '140px' },
        { key: 'staff', label: 'Staff' },
        { key: 'date', label: 'Date' },
        { key: 'detail', label: 'Detail' },
        { key: 'action', label: '', align: 'right', width: '130px' },
      ]">
        <tr v-for="f in flags" :key="f.id" class="border-b border-line-soft last:border-0 hover:bg-surface-sunken/50">
          <td class="px-3.5 py-2.5">
            <UiBadge :tone="['no_show', 'ot_weekly'].includes(f.flag_type) ? 'danger' : 'warning'">{{ f.flag_type }}</UiBadge>
          </td>
          <td class="px-3.5 py-2.5 font-semibold text-ink">{{ f.staff?.display_name }}</td>
          <td class="px-3.5 py-2.5 tabular-nums text-muted">{{ f.work_date }}</td>
          <td class="px-3.5 py-2.5 text-muted">{{ describeFlag(f) }}</td>
          <td class="px-3.5 py-2.5 text-right">
            <button v-if="f.status === 'open'" class="press rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-brown"
              @click="reviewFlag(f)">Mark reviewed</button>
            <UiBadge v-else tone="success">reviewed</UiBadge>
          </td>
        </tr>
        <tr v-if="!flags.length">
          <td colspan="5" class="px-3.5 py-8 text-center text-[13px] text-muted">
            No flags in this period. Lateness, no-shows and OT breaches appear here.
          </td>
        </tr>
      </UiTable>
    </template>

    <!-- ===== CORRECTIONS ===== -->
    <template v-if="tab === 'corrections'">
      <UiTable :columns="[
        { key: 'staff', label: 'Staff' },
        { key: 'date', label: 'Date' },
        { key: 'field', label: 'Field' },
        { key: 'change', label: 'Change' },
        { key: 'reason', label: 'Reason' },
        { key: 'status', label: 'Status', align: 'center', width: '100px' },
        { key: 'action', label: '', align: 'right', width: '190px' },
      ]">
        <tr v-for="c in corrections" :key="c.id" class="border-b border-line-soft last:border-0 hover:bg-surface-sunken/50">
          <td class="px-3.5 py-2.5 font-semibold text-ink">{{ c.staff?.display_name }}</td>
          <td class="px-3.5 py-2.5 tabular-nums text-muted">{{ c.work_date }}</td>
          <td class="px-3.5 py-2.5 font-mono text-[11.5px] text-muted">{{ c.field }}</td>
          <td class="px-3.5 py-2.5 tabular-nums">
            <span v-if="c.old_value" class="text-muted line-through">{{ fmtVal(c.old_value) }}</span>
            <span v-if="c.old_value" class="mx-1 text-muted">→</span>
            <strong class="text-ink">{{ fmtVal(c.new_value) }}</strong>
          </td>
          <td class="max-w-[220px] truncate px-3.5 py-2.5 text-muted">{{ c.reason || '—' }}</td>
          <td class="px-3.5 py-2.5 text-center">
            <UiBadge :tone="c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'warning'">{{ c.status }}</UiBadge>
          </td>
          <td class="px-3.5 py-2.5 text-right">
            <div v-if="c.status === 'pending'" class="flex justify-end gap-1.5">
              <button class="press rounded-md bg-yellow px-2.5 py-1 text-[12px] font-semibold text-brown" @click="decideCorrection(c, 'approved')">Approve</button>
              <button class="press rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-brown" @click="decideCorrection(c, 'rejected')">Reject</button>
            </div>
          </td>
        </tr>
        <tr v-if="!corrections.length">
          <td colspan="7" class="px-3.5 py-8 text-center text-[13px] text-muted">No corrections requested.</td>
        </tr>
      </UiTable>

      <div class="mt-6 rounded-lg border border-line bg-white p-4 shadow-warm-xs">
        <h3 class="font-display text-[16px] font-bold text-ink">Offline sheet import</h3>
        <p class="mt-1 text-[12.5px] text-muted">
          System was down? Paste the downtime sheet.
          <code class="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px]">employee_code,work_date,clock_in,clock_out,break_minutes,store_code</code>
        </p>
        <textarea v-model="importCsv" rows="4"
          class="mt-2.5 w-full rounded-md border border-line bg-white p-3 font-mono text-[12px]"
          placeholder="ST001,2026-08-06,09:30,18:35,60,FRAN01" />
        <div class="mt-2 flex items-center gap-3">
          <UiButton size="sm" :loading="importing" @click="runImport">Import</UiButton>
          <p v-if="importResult" class="text-[12.5px]" :class="importResult.failed ? 'text-warning' : 'text-success'">
            Imported {{ importResult.imported }}, failed {{ importResult.failed }}
          </p>
          <NuxtLink to="/help/offline-fallback" class="ml-auto text-[12px] font-semibold text-brown underline decoration-brown/30">
            Downtime procedure →
          </NuxtLink>
        </div>
      </div>
    </template>

    <!-- ===== PAYROLL ===== -->
    <template v-if="tab === 'payroll'">
      <UiTable :columns="[
        { key: 'period', label: 'Period' },
        { key: 'status', label: 'Status', align: 'center', width: '110px' },
        { key: 'approved', label: 'Approved' },
        { key: 'locked', label: 'Locked' },
        { key: 'action', label: '', align: 'right', width: '210px' },
      ]">
        <tr v-for="p in payPeriods" :key="p.id" class="border-b border-line-soft last:border-0">
          <td class="px-3.5 py-2.5 font-semibold tabular-nums text-ink">{{ p.start_date }} – {{ p.end_date }}</td>
          <td class="px-3.5 py-2.5 text-center">
            <UiBadge :tone="p.status === 'locked' ? 'ink' : p.status === 'approved' ? 'success' : 'muted'">{{ p.status }}</UiBadge>
          </td>
          <td class="px-3.5 py-2.5 text-[12px] text-muted">{{ p.approver?.display_name || '—' }}</td>
          <td class="px-3.5 py-2.5 text-[12px] text-muted">{{ p.locker?.display_name || '—' }}</td>
          <td class="px-3.5 py-2.5 text-right">
            <div v-if="isAreaManager" class="flex justify-end gap-1.5">
              <button v-if="p.status === 'open'" class="press rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-brown"
                @click="payAction(p, 'approve')">Approve</button>
              <button v-if="p.status === 'approved'" class="press rounded-md bg-yellow px-2.5 py-1 text-[12px] font-semibold text-brown"
                @click="payAction(p, 'lock')">Lock</button>
              <button v-if="p.status === 'locked'" class="press rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-danger"
                @click="payAction(p, 'reopen')">Reopen</button>
            </div>
          </td>
        </tr>
        <tr v-if="!payPeriods.length">
          <td colspan="5" class="px-3.5 py-8 text-center text-[13px] text-muted">No pay periods yet.</td>
        </tr>
      </UiTable>

      <div v-if="isAreaManager" class="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-4 shadow-warm-xs">
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Period start</span>
          <input v-model="newPeriod.start" type="date" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px]">
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Period end</span>
          <input v-model="newPeriod.end" type="date" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px]">
        </label>
        <UiButton size="sm" :loading="busy" @click="createPeriod">Create period</UiButton>
        <NuxtLink to="/help/payroll-lock" class="ml-auto text-[12px] font-semibold text-brown underline decoration-brown/30">
          Locking rules →
        </NuxtLink>
      </div>
    </template>

    <p v-if="error" class="mt-3 text-[13px] text-danger">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['supervisor-only'] })

const { isAreaManager } = useSession()
const route = useRoute()

const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const from = ref(addDays(today, -13))
const to = ref(today)
const storeId = ref('')
const error = ref('')
const busy = ref(false)

const tab = ref(typeof route.query.tab === 'string' ? route.query.tab : 'hours')

const { data: storesRes } = await useFetch<any>('/api/v1/stores')
const stores = computed<any[]>(() => (storesRes.value?.data || []).filter((s: any) => s.kind === 'store'))

const query = computed(() => ({ from: from.value, to: to.value, store_id: storeId.value || undefined }))

const { data: hoursRes } = await useFetch<any>('/api/v1/reports/hours', { query, watch: [from, to, storeId] })
const summary = computed<any>(() => hoursRes.value?.data)

const { data: flagsRes, refresh: refreshFlags } = await useFetch<any>('/api/v1/flags', { query, watch: [from, to, storeId] })
const flags = computed<any[]>(() => flagsRes.value?.data || [])

const { data: corrRes, refresh: refreshCorr } = await useFetch<any>('/api/v1/corrections')
const corrections = computed<any[]>(() => corrRes.value?.data || [])

const { data: payRes, refresh: refreshPay } = await useFetch<any>('/api/v1/pay-periods', { default: () => ({ data: [] }) })
const payPeriods = computed<any[]>(() => payRes.value?.data || [])

const tabs = computed(() => [
  { key: 'hours', label: 'Hours', count: 0 },
  { key: 'flags', label: 'Flags', count: flags.value.filter((f) => f.status === 'open').length },
  { key: 'corrections', label: 'Corrections', count: corrections.value.filter((c) => c.status === 'pending').length },
  { key: 'payroll', label: 'Payroll', count: 0 },
])

const hoursColumns = computed(() => {
  const cols: any[] = [
    { key: 'staff', label: 'Staff' },
    { key: 'type', label: 'Type', width: '70px' },
    { key: 'hours', label: 'Hours', align: 'right' },
    { key: 'days', label: 'Days', align: 'right' },
    { key: 'ot', label: 'Weekly OT', align: 'right' },
    { key: 'incomplete', label: 'Incomplete', align: 'right' },
    { key: 'flags', label: 'Flags', align: 'right' },
  ]
  if (isAreaManager.value) cols.push({ key: 'cost', label: 'Est. cost', align: 'right' })
  return cols
})

const totalHours = computed(() =>
  Math.round((summary.value?.rows || []).reduce((s: number, r: any) => s + r.total_hours, 0) * 10) / 10)
const totalOt = computed(() =>
  Math.round((summary.value?.rows || []).reduce((s: number, r: any) => s + (r.weekly_ot_hours || 0), 0) * 10) / 10)
const incomplete = computed(() =>
  (summary.value?.rows || []).reduce((s: number, r: any) => s + (r.incomplete_entries || 0), 0))

const exportUrl = computed(() => {
  const p = new URLSearchParams({ from: from.value, to: to.value, format: 'csv' })
  if (storeId.value) p.set('store_id', storeId.value)
  return `/api/v1/reports/attendance?${p}`
})

async function reviewFlag(f: any) {
  await $fetch(`/api/v1/flags/${f.id}/review`, { method: 'POST' }).catch(() => {})
  await refreshFlags()
}

async function decideCorrection(c: any, decision: string) {
  try {
    await $fetch(`/api/v1/corrections/${c.id}/decide`, { method: 'POST', body: { decision } })
    await refreshCorr()
  } catch (err: any) { error.value = err?.data?.message || err?.data?.statusMessage || 'Failed' }
}

const newPeriod = reactive({ start: '', end: '' })
async function createPeriod() {
  busy.value = true; error.value = ''
  try {
    await $fetch('/api/v1/pay-periods', { method: 'POST', body: { start_date: newPeriod.start, end_date: newPeriod.end } })
    await refreshPay()
  } catch (err: any) { error.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { busy.value = false }
}

async function payAction(p: any, action: string) {
  error.value = ''
  try {
    await $fetch(`/api/v1/pay-periods/${p.id}/lock`, { method: 'POST', body: { action } })
    await refreshPay()
  } catch (err: any) { error.value = err?.data?.message || err?.data?.statusMessage || 'Failed' }
}

const importCsv = ref('')
const importing = ref(false)
const importResult = ref<any>(null)

async function runImport() {
  importing.value = true
  importResult.value = null
  try {
    const header = 'employee_code,work_date,clock_in,clock_out,break_minutes,store_code'
    const csv = importCsv.value.trim().toLowerCase().startsWith('employee_code')
      ? importCsv.value : `${header}\n${importCsv.value}`
    importResult.value = await $fetch('/api/v1/time-entries/import', { method: 'POST', body: { csv } })
    await refreshCorr()
  } catch (err: any) {
    error.value = err?.data?.message || err?.data?.statusMessage || 'Import failed'
  } finally { importing.value = false }
}

function flagSum(r: any) {
  return Object.values(r.flags || {}).reduce((a: any, b: any) => a + b, 0)
}
function flagLabel(r: any) {
  return Object.entries(r.flags || {}).map(([k, v]) => `${k} ${v}`).join(', ')
}
function describeFlag(f: any) {
  const d = f.details || {}
  if (d.minutes_late) return `${d.minutes_late} min late (grace ${d.grace_minutes})`
  if (d.minutes_early) return `${d.minutes_early} min early (grace ${d.grace_minutes})`
  if (d.hours) return `${d.hours}h worked, threshold ${d.threshold}h`
  return d.note || '—'
}
function fmtVal(v: string) {
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) {
    return new Date(v).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })
  }
  return v
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
</script>
