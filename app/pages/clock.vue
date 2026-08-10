<template>
  <div>
    <UiPageHeader eyebrow="Time & attendance" title="Clock"
      subtitle="Scan your store's daily QR to clock in. Breaks and clocking out need no rescan." />

    <div class="grid gap-6 lg:grid-cols-3">
      <!-- Clock panel -->
      <div class="lg:col-span-2">
        <div class="rounded-lg border border-line-soft bg-white p-5 shadow-warm-sm">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p class="eyebrow flex items-center gap-1.5">
                {{ status?.on_break ? 'On break' : status?.open_entry ? 'Clocked in' : 'Off the clock' }}
                <UiSpinner v-if="statusPending" size="xs" />
              </p>
              <p class="mt-0.5 font-display text-[38px] font-bold leading-[42px] tabular-nums tracking-tight text-ink">{{ clockFace }}</p>
              <p v-if="status?.open_entry" class="text-[12.5px] text-muted">
                In since {{ fmtTime(status.open_entry.clock_in_at) }}
                <span v-if="status.open_entry.break_minutes"> · {{ status.open_entry.break_minutes }} min break taken</span>
                · {{ elapsed }} elapsed
              </p>
              <p v-else-if="status?.shift" class="text-[12.5px] text-muted">
                Shift {{ fmtTime(status.shift.start_at) }}–{{ fmtTime(status.shift.end_at) }} at {{ status.shift.store?.name }}
              </p>
              <p v-else class="text-[12.5px] text-muted">No published shift today.</p>
            </div>

            <div class="w-full max-w-xs">
              <template v-if="!status?.open_entry">
                <UiInput v-model="qrToken" label="Store QR code" placeholder="hrmqr_…" />
                <UiButton class="mt-2.5 w-full" :loading="acting" @click="act('clock_in')">Clock in</UiButton>
              </template>
              <template v-else>
                <div class="flex gap-2">
                  <UiButton v-if="!status.on_break" variant="tonal" size="sm" class="flex-1" :loading="acting" @click="act('break_start')">Start break</UiButton>
                  <UiButton v-else variant="tonal" size="sm" class="flex-1" :loading="acting" @click="act('break_end')">End break</UiButton>
                  <UiButton variant="secondary" size="sm" class="flex-1" :loading="acting" @click="act('clock_out')">Clock out</UiButton>
                </div>
              </template>
              <p v-if="message" class="mt-2 text-[12.5px]" :class="messageTone === 'error' ? 'text-danger' : 'text-success'">{{ message }}</p>
            </div>
          </div>
        </div>

        <!-- Today's entries -->
        <h2 class="mb-2 mt-6 font-display text-[18px] font-bold text-ink">Today's entries</h2>
        <UiTable :columns="[
          { key: 'in', label: 'In' },
          { key: 'out', label: 'Out' },
          { key: 'break', label: 'Break', align: 'right' },
          { key: 'net', label: 'Net hours', align: 'right' },
          { key: 'source', label: 'Source', align: 'right' },
        ]">
          <tr v-for="e in status?.entries_today || []" :key="e.id" class="border-b border-line-soft last:border-0">
            <td class="px-3.5 py-2.5 font-semibold tabular-nums">{{ fmtTime(e.clock_in_at) }}</td>
            <td class="px-3.5 py-2.5 tabular-nums">{{ e.clock_out_at ? fmtTime(e.clock_out_at) : '—' }}</td>
            <td class="px-3.5 py-2.5 text-right tabular-nums text-muted">{{ e.break_minutes }}m</td>
            <td class="px-3.5 py-2.5 text-right font-semibold tabular-nums">{{ netHours(e) }}</td>
            <td class="px-3.5 py-2.5 text-right"><UiBadge tone="muted">{{ e.source }}</UiBadge></td>
          </tr>
          <tr v-if="!(status?.entries_today || []).length">
            <td colspan="5" class="px-3.5 py-6 text-center text-[13px] text-muted">Nothing clocked yet today.</td>
          </tr>
        </UiTable>

        <!-- Recent history -->
        <h2 class="mb-2 mt-6 font-display text-[18px] font-bold text-ink">Last 14 days</h2>
        <UiTable :columns="[
          { key: 'date', label: 'Date' },
          { key: 'in', label: 'In' },
          { key: 'out', label: 'Out' },
          { key: 'break', label: 'Break', align: 'right' },
          { key: 'net', label: 'Net', align: 'right' },
        ]">
          <tr v-for="e in history" :key="e.id" class="border-b border-line-soft last:border-0">
            <td class="px-3.5 py-2 tabular-nums">{{ e.work_date }}</td>
            <td class="px-3.5 py-2 tabular-nums">{{ e.clock_in_at ? fmtTime(e.clock_in_at) : '—' }}</td>
            <td class="px-3.5 py-2 tabular-nums" :class="!e.clock_out_at ? 'text-warning' : ''">
              {{ e.clock_out_at ? fmtTime(e.clock_out_at) : 'missing' }}
            </td>
            <td class="px-3.5 py-2 text-right tabular-nums text-muted">{{ e.break_minutes }}m</td>
            <td class="px-3.5 py-2 text-right font-semibold tabular-nums">{{ netHours(e) }}</td>
          </tr>
          <tr v-if="!history.length">
            <td colspan="5" class="px-3.5 py-6 text-center text-[13px] text-muted">No entries in the last two weeks.</td>
          </tr>
        </UiTable>
      </div>

      <!-- Side: corrections + store QR -->
      <div>
        <!-- My check-in QR (reverse scan): staff show this, supervisor scans -->
        <div class="mb-4 rounded-lg border border-yellow-deep/40 bg-yellow-soft/40 p-4 text-center shadow-warm-xs">
          <h3 class="font-display text-[16px] font-bold text-ink">Check in at the counter</h3>
          <p class="mt-1 text-[12px] text-muted">Show this to your supervisor's scanner.</p>
          <div v-if="showMyQr && myQr" class="mx-auto mt-3 max-w-[200px]" v-html="myQr.svg" />
          <p v-if="showMyQr && myQr" class="mt-1.5 text-[11px] text-muted">
            Refreshes automatically · <span class="tabular-nums">{{ myQrCountdown }}s</span>
          </p>
          <p v-if="showMyQr && myQr" class="mt-1 break-all font-mono text-[9px] text-line-strong">{{ myQr.token }}</p>
          <UiButton variant="tonal" size="sm" class="mt-3 w-full" :loading="myQrLoading" @click="toggleMyQr">
            {{ showMyQr ? 'Hide my QR' : 'Show my check-in QR' }}
          </UiButton>
        </div>

        <div class="rounded-lg border border-line bg-white p-4 shadow-warm-xs">
          <h3 class="font-display text-[16px] font-bold text-ink">Missed a clock?</h3>
          <p class="mt-1 text-[12px] text-muted">
            Flag it for your supervisor. The original record is kept.
          </p>
          <form class="mt-3 space-y-2.5" @submit.prevent="submitCorrection">
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Date</span>
              <input v-model="corr.work_date" type="date" class="h-9 w-full rounded-md border border-line bg-white px-2.5 text-[13px]">
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">What's wrong</span>
              <select v-model="corr.field" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
                <option value="clock_in_at">Clock-in time</option>
                <option value="clock_out_at">Clock-out time</option>
                <option value="add_entry">Whole day missing</option>
              </select>
            </label>
            <div v-if="corr.field !== 'add_entry'">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Correct time</span>
              <input v-model="corr.time" type="time" class="h-9 w-full rounded-md border border-line bg-white px-2.5 text-[13px]">
            </div>
            <div v-else class="grid grid-cols-2 gap-2">
              <div>
                <span class="mb-1 block text-[11px] font-semibold text-ink-soft">In</span>
                <input v-model="corr.timeIn" type="time" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
              </div>
              <div>
                <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Out</span>
                <input v-model="corr.timeOut" type="time" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
              </div>
            </div>
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Reason</span>
              <input v-model="corr.reason" placeholder="Forgot to clock out after closing"
                class="h-9 w-full rounded-md border border-line bg-white px-2.5 text-[13px]">
            </label>
            <UiButton type="submit" variant="secondary" size="sm" class="w-full" :loading="corrSubmitting">Submit correction</UiButton>
            <p v-if="corrMessage" class="text-[12px]" :class="corrTone === 'error' ? 'text-danger' : 'text-success'">{{ corrMessage }}</p>
          </form>
        </div>

        <!-- My pending corrections -->
        <div v-if="myCorrections.length" class="mt-4 overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-xs">
          <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">My requests</p>
          <div v-for="c in myCorrections" :key="c.id" class="border-b border-line-soft px-3.5 py-2 last:border-0">
            <div class="flex items-center gap-2">
              <span class="flex-1 text-[12.5px] tabular-nums">{{ c.work_date }}</span>
              <UiBadge :tone="c.status === 'approved' ? 'success' : c.status === 'rejected' ? 'danger' : 'warning'">{{ c.status }}</UiBadge>
            </div>
            <p class="text-[11.5px] text-muted">{{ c.field }} → {{ fmtVal(c.new_value) }}</p>
          </div>
        </div>

        <!-- Store QR (supervisor+) -->
        <div v-if="isSupervisor" class="mt-4 rounded-lg border border-line bg-white p-4 text-center shadow-warm-xs">
          <h3 class="font-display text-[16px] font-bold text-ink">Today's store QR</h3>
          <p class="mt-1 text-[12px] text-muted">Rotates daily. Display at the counter.</p>
          <div v-if="qr" class="mx-auto mt-3 max-w-[220px]" v-html="qr.svg" />
          <p v-if="qr" class="mt-2 break-all font-mono text-[10px] text-muted">{{ qr.token }}</p>
          <UiButton variant="tonal" size="sm" class="mt-3 w-full" :loading="qrLoading" @click="loadQr">
            {{ qr ? 'Refresh' : 'Show QR' }}
          </UiButton>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { staff, isSupervisor } = useSession()
const route = useRoute()

const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)

const { data: statusRes, refresh: refreshStatus, pending: statusPending } = await useFetch<any>('/api/v1/clock/status')
const status = computed<any>(() => statusRes.value?.data)

const { data: historyRes, refresh: refreshHistory } = await useFetch<any>('/api/v1/time-entries', {
  query: { from: addDays(today, -13), to: today, limit: 30 }, default: () => ({ data: [] }),
})
const history = computed<any[]>(() =>
  (historyRes.value?.data || []).filter((e: any) => e.work_date !== today))

const { data: corrRes, refresh: refreshCorr } = await useFetch<any>('/api/v1/corrections', { default: () => ({ data: [] }) })
const myCorrections = computed<any[]>(() => (corrRes.value?.data || []).slice(0, 5))

const qrToken = ref(typeof route.query.token === 'string' ? route.query.token : '')
const acting = ref(false)
const message = ref('')
const messageTone = ref<'ok' | 'error'>('ok')

async function act(action: string) {
  acting.value = true
  message.value = ''
  try {
    const res: any = await $fetch('/api/v1/clock', {
      method: 'POST',
      body: { action, qr_token: action === 'clock_in' ? qrToken.value || undefined : undefined },
    })
    messageTone.value = 'ok'
    message.value = action === 'clock_in'
      ? `Clocked in${res.flags?.length ? ` — flagged: ${res.flags.join(', ')}` : ''}`
      : action === 'clock_out' ? 'Clocked out. See you next shift.' : 'Break updated'
    await Promise.all([refreshStatus(), refreshHistory()])
  } catch (err: any) {
    messageTone.value = 'error'
    message.value = err?.data?.message || err?.data?.statusMessage || 'Something went wrong'
  } finally { acting.value = false }
}

const corr = reactive({ work_date: '', field: 'clock_out_at', time: '', timeIn: '', timeOut: '', reason: '' })
const corrSubmitting = ref(false)
const corrMessage = ref('')
const corrTone = ref<'ok' | 'error'>('ok')

async function submitCorrection() {
  corrSubmitting.value = true
  corrMessage.value = ''
  try {
    const newValue = corr.field === 'add_entry'
      ? `${corr.timeIn}-${corr.timeOut}`
      : `${corr.work_date}T${corr.time}:00+08:00`
    await $fetch('/api/v1/corrections', {
      method: 'POST',
      body: { work_date: corr.work_date, field: corr.field, new_value: newValue, reason: corr.reason },
    })
    corrTone.value = 'ok'
    corrMessage.value = 'Submitted for review.'
    await refreshCorr()
  } catch (err: any) {
    corrTone.value = 'error'
    corrMessage.value = err?.data?.message || err?.data?.statusMessage || 'Failed to submit'
  } finally { corrSubmitting.value = false }
}

// ── my check-in QR (reverse scan) ──
const myQr = ref<any>(null)
const showMyQr = ref(false)
const myQrLoading = ref(false)
const myQrCountdown = ref(0)
let myQrTimer: any = null
let myQrCountdownTimer: any = null

async function loadMyQr() {
  myQrLoading.value = true
  try {
    const res: any = await $fetch('/api/v1/clock/my-qr')
    myQr.value = res.data
    const ttl = Math.floor((myQr.value?.ttl_ms || 60000) / 1000)
    myQrCountdown.value = ttl
    if (myQrCountdownTimer) clearInterval(myQrCountdownTimer)
    myQrCountdownTimer = setInterval(() => { myQrCountdown.value = Math.max(0, myQrCountdown.value - 1) }, 1000)
  } finally { myQrLoading.value = false }
}
async function toggleMyQr() {
  showMyQr.value = !showMyQr.value
  if (showMyQr.value) {
    await loadMyQr()
    if (myQrTimer) clearInterval(myQrTimer)
    myQrTimer = setInterval(loadMyQr, Math.max(15000, (myQr.value?.ttl_ms || 60000) - 5000))
  } else {
    if (myQrTimer) { clearInterval(myQrTimer); myQrTimer = null }
    if (myQrCountdownTimer) { clearInterval(myQrCountdownTimer); myQrCountdownTimer = null }
    myQr.value = null
  }
}

const qr = ref<any>(null)
const qrLoading = ref(false)

async function loadQr() {
  if (!staff.value?.home_store_id) return
  qrLoading.value = true
  try {
    const res: any = await $fetch('/api/v1/clock/qr', { query: { store_id: staff.value.home_store_id } })
    qr.value = res.data
  } finally { qrLoading.value = false }
}

const now = ref(new Date())
let timer: any
onMounted(() => { timer = setInterval(() => (now.value = new Date()), 1000) })
onUnmounted(() => {
  clearInterval(timer)
  if (myQrTimer) clearInterval(myQrTimer)
  if (myQrCountdownTimer) clearInterval(myQrCountdownTimer)
})

const clockFace = computed(() =>
  now.value.toLocaleTimeString('en-SG', { hour12: false, timeZone: 'Asia/Singapore' }))

const elapsed = computed(() => {
  const start = status.value?.open_entry?.clock_in_at
  if (!start) return ''
  const mins = Math.floor((now.value.getTime() - new Date(start).getTime()) / 60000)
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m`
})

function netHours(e: any) {
  if (!e.clock_in_at || !e.clock_out_at) return '—'
  const h = (new Date(e.clock_out_at).getTime() - new Date(e.clock_in_at).getTime()) / 3600000 - (e.break_minutes || 0) / 60
  return (Math.round(h * 100) / 100).toFixed(2)
}
function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })
}
function fmtVal(v: string) {
  if (/^\d{4}-\d{2}-\d{2}T/.test(v)) return fmtTime(v)
  return v
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
</script>
