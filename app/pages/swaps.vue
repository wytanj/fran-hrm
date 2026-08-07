<template>
  <div>
    <UiPageHeader eyebrow="Scheduling" title="Shift swaps"
      subtitle="Requests close 24 hours before the shift starts and need supervisor approval. Approval reassigns the shift automatically." />

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="lg:col-span-2">
        <div class="mb-2 flex items-center justify-between">
          <h2 class="font-display text-[18px] font-bold text-ink">{{ isSupervisor ? 'All swaps' : 'My swaps' }}</h2>
          <div class="flex gap-1">
            <button v-for="s in filters" :key="s.key" type="button"
              class="press rounded-md px-2.5 py-1 text-[12px] font-semibold"
              :class="statusFilter === s.key ? 'bg-yellow-soft text-brown' : 'text-muted hover:bg-surface-sunken'"
              @click="statusFilter = s.key">
              {{ s.label }}
            </button>
          </div>
        </div>

        <UiBusy :busy="pending" label="Loading…">
        <UiTable :columns="[
          { key: 'shift', label: 'Shift' },
          { key: 'from', label: 'From' },
          { key: 'to', label: 'To' },
          { key: 'reason', label: 'Reason' },
          { key: 'status', label: 'Status', align: 'center', width: '100px' },
          { key: 'action', label: '', align: 'right', width: '175px' },
        ]">
          <tr v-for="s in swaps" :key="s.id" class="border-b border-line-soft last:border-0 hover:bg-surface-sunken/50">
            <td class="px-3.5 py-2.5 tabular-nums">
              <span class="font-semibold text-ink">{{ s.shift?.work_date }}</span>
              <span class="ml-1.5 text-muted">{{ fmtTime(s.shift?.start_at) }}–{{ fmtTime(s.shift?.end_at) }}</span>
            </td>
            <td class="px-3.5 py-2.5">{{ s.requester?.display_name }}</td>
            <td class="px-3.5 py-2.5 font-semibold text-ink">{{ s.counterpart?.display_name }}</td>
            <td class="max-w-[180px] truncate px-3.5 py-2.5 text-muted">{{ s.reason || '—' }}</td>
            <td class="px-3.5 py-2.5 text-center">
              <UiBadge :tone="s.status === 'approved' ? 'success' : s.status === 'rejected' ? 'danger' : 'warning'">{{ s.status }}</UiBadge>
            </td>
            <td class="px-3.5 py-2.5 text-right">
              <div v-if="isSupervisor && s.status === 'pending'" class="flex justify-end gap-1.5">
                <button class="press rounded-md bg-yellow px-2.5 py-1 text-[12px] font-semibold text-brown" @click="decide(s, 'approved')">Approve</button>
                <button class="press rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-brown" @click="decide(s, 'rejected')">Reject</button>
              </div>
            </td>
          </tr>
          <tr v-if="!swaps.length">
            <td colspan="6" class="px-3.5 py-8 text-center text-[13px] text-muted">No swap requests.</td>
          </tr>
        </UiTable>
        </UiBusy>
      </div>

      <div>
        <div class="rounded-lg border border-line bg-white p-4 shadow-warm-xs">
          <h3 class="font-display text-[16px] font-bold text-ink">Offer a shift</h3>
          <form class="mt-3 space-y-2.5" @submit.prevent="submit">
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">My shift</span>
              <select v-model="form.shift_id" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
                <option v-for="s in myShifts" :key="s.id" :value="s.id">
                  {{ s.work_date }} · {{ fmtTime(s.start_at) }}–{{ fmtTime(s.end_at) }}
                </option>
              </select>
              <span v-if="!myShifts.length" class="mt-1 block text-[11.5px] text-muted">
                No upcoming shifts outside the 24h cutoff.
              </span>
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Teammate to take it</span>
              <select v-model="form.counterpart_staff_id" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
                <option v-for="m in teammates" :key="m.id" :value="m.id">{{ m.display_name }} ({{ m.employee_code }})</option>
              </select>
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Reason</span>
              <input v-model="form.reason" placeholder="Optional"
                class="h-9 w-full rounded-md border border-line bg-white px-2.5 text-[13px]">
            </label>
            <UiButton type="submit" size="sm" class="w-full" :loading="submitting" :disabled="!myShifts.length">
              Request swap
            </UiButton>
            <p v-if="message" class="text-[12px]" :class="messageTone === 'error' ? 'text-danger' : 'text-success'">{{ message }}</p>
          </form>
        </div>

        <NuxtLink to="/help/availability-and-swaps" class="press mt-3 block text-[12px] font-semibold text-brown underline decoration-brown/30">
          Swap rules →
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { staff, isSupervisor } = useSession()

const filters = [
  { key: 'pending', label: 'pending' },
  { key: 'approved', label: 'approved' },
  { key: '', label: 'all' },
]
const statusFilter = ref('pending')

const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
const { data: shiftsRes } = await useFetch<any>('/api/v1/shifts', { query: { from: today, to: addDays(today, 28) } })

// Only shifts still outside the 24h cutoff can be offered — showing the rest
// would let someone submit a request the API is going to refuse.
const myShifts = computed<any[]>(() =>
  (shiftsRes.value?.data || []).filter((s: any) =>
    s.staff_id === staff.value?.id && new Date(s.start_at).getTime() - Date.now() > 24 * 3600_000))

const { data: staffRes } = await useFetch<any>('/api/v1/staff', {
  query: { limit: 100, employment_status: 'active' }, server: false, default: () => ({ data: [] }),
})
const teammates = computed<any[]>(() =>
  (staffRes.value?.data || []).filter((m: any) => m.id !== staff.value?.id))

const { data: swapsRes, refresh, pending } = await useFetch<any>('/api/v1/swaps', {
  query: computed(() => ({ status: statusFilter.value || undefined })), watch: [statusFilter],
})
const swaps = computed<any[]>(() => swapsRes.value?.data || [])

const form = reactive({ shift_id: '', counterpart_staff_id: '', reason: '' })
watch(myShifts, () => { if (!form.shift_id && myShifts.value.length) form.shift_id = myShifts.value[0].id }, { immediate: true })
watch(teammates, () => { if (!form.counterpart_staff_id && teammates.value.length) form.counterpart_staff_id = teammates.value[0].id }, { immediate: true })

const submitting = ref(false)
const message = ref('')
const messageTone = ref<'ok' | 'error'>('ok')

async function submit() {
  submitting.value = true; message.value = ''
  try {
    await $fetch('/api/v1/swaps', { method: 'POST', body: { ...form } })
    messageTone.value = 'ok'
    message.value = 'Requested — pending approval.'
    await refresh()
  } catch (err: any) {
    messageTone.value = 'error'
    message.value = err?.data?.message || err?.data?.statusMessage || 'Failed to request swap'
  } finally { submitting.value = false }
}

async function decide(s: any, decision: string) {
  try {
    await $fetch(`/api/v1/swaps/${s.id}/decide`, { method: 'POST', body: { decision } })
    await refresh()
  } catch (err: any) {
    messageTone.value = 'error'
    message.value = err?.data?.message || err?.data?.statusMessage || 'Failed'
  }
}

function fmtTime(iso?: string) {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
</script>
