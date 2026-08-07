<template>
  <div>
    <UiPageHeader eyebrow="Time off" title="Leave"
      :subtitle="isManager ? 'Approve requests and track balances. Approved leave blocks roster slots automatically.' : 'Apply for leave and track your balances.'" />

    <!-- Balances -->
    <div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <UiStat v-for="b in balances" :key="b.leave_type"
        :label="`${b.leave_type} remaining`" :value="b.remaining_days" unit="d"
        :hint="`${b.used_days} used of ${b.entitled_days}`"
        :tone="b.remaining_days <= 0 ? 'warning' : 'ink'" />
      <UiStat v-if="!balances.length" label="Leave balances" value="—" hint="No entitlements configured" />
    </div>

    <div class="grid gap-6 lg:grid-cols-3">
      <!-- Requests table -->
      <div class="lg:col-span-2">
        <div class="mb-2 flex items-center justify-between">
          <h2 class="font-display text-[18px] font-bold text-ink">{{ isManager ? 'All requests' : 'My requests' }}</h2>
          <div class="flex gap-1">
            <button v-for="s in ['pending', 'approved', 'rejected']" :key="s" type="button"
              class="press rounded-md px-2.5 py-1 text-[12px] font-semibold"
              :class="tab === s ? 'bg-yellow-soft text-brown' : 'text-muted hover:bg-surface-sunken'"
              @click="tab = s">
              {{ s }}
            </button>
          </div>
        </div>

        <UiBusy :busy="requestsPending" label="Loading…">
        <UiTable :columns="columns">
          <tr v-for="r in requests" :key="r.id" class="border-b border-line-soft last:border-0 hover:bg-surface-sunken/50">
            <td v-if="isManager" class="px-3.5 py-2.5 font-semibold text-ink">{{ r.staff?.display_name }}</td>
            <td class="px-3.5 py-2.5"><UiBadge tone="accent">{{ r.leave_type?.code }}</UiBadge></td>
            <td class="px-3.5 py-2.5 tabular-nums">
              {{ r.start_date }}<span v-if="r.end_date !== r.start_date"> → {{ r.end_date }}</span>
            </td>
            <td class="px-3.5 py-2.5 text-right tabular-nums font-semibold">{{ r.days }}</td>
            <td class="max-w-[200px] truncate px-3.5 py-2.5 text-muted">{{ r.reason || '—' }}</td>
            <td class="px-3.5 py-2.5 text-center">
              <UiBadge :tone="r.status === 'approved' ? 'success' : r.status === 'rejected' ? 'danger' : 'warning'">{{ r.status }}</UiBadge>
            </td>
            <td class="px-3.5 py-2.5 text-right">
              <div v-if="isManager && r.status === 'pending'" class="flex justify-end gap-1.5">
                <button class="press rounded-md bg-yellow px-2.5 py-1 text-[12px] font-semibold text-brown" @click="decide(r, 'approved')">Approve</button>
                <button class="press rounded-md border border-line px-2.5 py-1 text-[12px] font-semibold text-brown" @click="decide(r, 'rejected')">Reject</button>
              </div>
              <span v-else-if="r.decided_at" class="text-[11.5px] text-muted">{{ r.decider?.display_name || '' }}</span>
            </td>
          </tr>
          <tr v-if="!requests.length">
            <td :colspan="columns.length" class="px-3.5 py-8 text-center text-[13px] text-muted">No {{ tab }} requests.</td>
          </tr>
        </UiTable>
        </UiBusy>
      </div>

      <!-- Apply form -->
      <div>
        <div class="rounded-lg border border-line bg-white p-4 shadow-warm-xs">
          <h3 class="font-display text-[16px] font-bold text-ink">Apply for leave</h3>
          <form class="mt-3 space-y-2.5" @submit.prevent="apply">
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Type</span>
              <select v-model="form.leave_type_id" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
                <option v-for="t in types" :key="t.id" :value="t.id">{{ t.name }} ({{ t.code }})</option>
              </select>
            </label>
            <div class="grid grid-cols-2 gap-2">
              <label class="block">
                <span class="mb-1 block text-[11px] font-semibold text-ink-soft">From</span>
                <input v-model="form.start_date" type="date" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
              </label>
              <label class="block">
                <span class="mb-1 block text-[11px] font-semibold text-ink-soft">To</span>
                <input v-model="form.end_date" type="date" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
              </label>
            </div>
            <label class="flex items-center gap-2 text-[12.5px] text-ink-soft">
              <input v-model="form.half_day" type="checkbox" class="h-3.5 w-3.5 accent-brown"> Half day (single date)
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Reason</span>
              <input v-model="form.reason" placeholder="Optional"
                class="h-9 w-full rounded-md border border-line bg-white px-2.5 text-[13px]">
            </label>
            <UiButton type="submit" size="sm" class="w-full" :loading="applying">Submit request</UiButton>
            <p v-if="applyMessage" class="text-[12px]" :class="applyTone === 'error' ? 'text-danger' : 'text-success'">{{ applyMessage }}</p>
          </form>
        </div>

        <div class="mt-4 overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-xs">
          <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Leave types</p>
          <div v-for="t in types" :key="t.id" class="flex items-center gap-2 border-b border-line-soft px-3.5 py-2 last:border-0">
            <span class="font-mono text-[11.5px] font-semibold text-brown">{{ t.code }}</span>
            <span class="flex-1 text-[12.5px] text-ink">{{ t.name }}</span>
            <UiBadge :tone="t.is_paid ? 'success' : 'muted'">{{ t.is_paid ? 'paid' : 'unpaid' }}</UiBadge>
          </div>
        </div>

        <NuxtLink to="/help/leave-requests" class="press mt-3 block text-[12px] font-semibold text-brown underline decoration-brown/30">
          Leave policy →
        </NuxtLink>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { isManager } = useSession()

const { data: typesRes } = await useFetch<any>('/api/v1/leave/types')
const types = computed<any[]>(() => typesRes.value?.data || [])

const { data: balancesRes, refresh: refreshBalances } = await useFetch<any>('/api/v1/leave/balances', { default: () => ({ data: [] }) })
const balances = computed<any[]>(() => balancesRes.value?.data || [])

const tab = ref('pending')
const { data: requestsRes, refresh: refreshRequests, pending: requestsPending } = await useFetch<any>('/api/v1/leave/requests', {
  query: computed(() => ({ status: tab.value })), watch: [tab],
})
const requests = computed<any[]>(() => requestsRes.value?.data || [])

const columns = computed(() => {
  const cols: any[] = []
  if (isManager.value) cols.push({ key: 'staff', label: 'Staff' })
  cols.push(
    { key: 'type', label: 'Type', width: '70px' },
    { key: 'dates', label: 'Dates' },
    { key: 'days', label: 'Days', align: 'right', width: '70px' },
    { key: 'reason', label: 'Reason' },
    { key: 'status', label: 'Status', align: 'center', width: '100px' },
    { key: 'action', label: '', align: 'right', width: '175px' },
  )
  return cols
})

const form = reactive({ leave_type_id: '', start_date: '', end_date: '', half_day: false, reason: '' })
watch(types, () => { if (!form.leave_type_id && types.value.length) form.leave_type_id = types.value[0].id }, { immediate: true })

const applying = ref(false)
const applyMessage = ref('')
const applyTone = ref<'ok' | 'error'>('ok')

async function apply() {
  applying.value = true; applyMessage.value = ''
  try {
    await $fetch('/api/v1/leave/requests', {
      method: 'POST', body: { ...form, end_date: form.end_date || form.start_date },
    })
    applyTone.value = 'ok'
    applyMessage.value = 'Submitted — pending approval.'
    await Promise.all([refreshRequests(), refreshBalances()])
  } catch (err: any) {
    applyTone.value = 'error'
    applyMessage.value = err?.data?.message || err?.data?.statusMessage || 'Failed to submit'
  } finally { applying.value = false }
}

async function decide(r: any, decision: string) {
  try {
    await $fetch(`/api/v1/leave/requests/${r.id}/decide`, { method: 'POST', body: { decision } })
    await Promise.all([refreshRequests(), refreshBalances()])
  } catch (err: any) {
    applyTone.value = 'error'
    applyMessage.value = err?.data?.message || err?.data?.statusMessage || 'Failed'
  }
}
</script>
