<template>
  <div>
    <UiPageHeader eyebrow="People" title="Org & accountability"
      subtitle="Who sits where, who reports to whom, and — the part that matters — who is accountable for each outcome.">
      <template #actions>
        <div class="flex gap-1 rounded-md border border-line bg-white p-0.5">
          <button v-for="t in tabs" :key="t.key" type="button"
            class="press rounded px-2.5 py-1 text-[12.5px] font-semibold"
            :class="tab === t.key ? 'bg-yellow-soft text-brown' : 'text-muted'"
            @click="tab = t.key">
            {{ t.label }}
          </button>
        </div>
      </template>
    </UiPageHeader>

    <!-- ===== CHART ===== -->
    <template v-if="tab === 'chart'">
      <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UiStat label="Seats" :value="chart?.seat_count || 0" />
        <UiStat label="Filled" :value="chart?.filled || 0" />
        <UiStat label="Vacancies" :value="vacancyCount" :tone="vacancyCount ? 'warning' : 'ink'" />
        <UiStat label="Unseated staff" :value="chart?.unassigned?.length || 0"
          :tone="chart?.unassigned?.length ? 'warning' : 'ink'" hint="Nobody should be off the chart" />
      </div>

      <div class="rounded-lg border border-line-soft bg-surface-sunken/40 p-4">
        <ul class="space-y-2">
          <OrgNode v-for="root in chart?.roots || []" :key="root.id" :node="root" />
        </ul>
      </div>

      <div v-if="chart?.unassigned?.length" class="mt-4 rounded-lg border border-warning/30 bg-warning-soft p-3.5">
        <p class="text-[12.5px] font-semibold text-warning">{{ chart.unassigned.length }} staff not assigned to a seat</p>
        <p class="mt-1 text-[12px] text-ink-soft">
          {{ chart.unassigned.map((s) => `${s.display_name} (${s.employee_code})`).join(', ') }}
        </p>
      </div>

      <p class="mt-3 text-[11.5px] text-muted">
        Bold names are what we say in comms; the grey line beneath is the internal title used for HR and payroll.
      </p>
    </template>

    <!-- ===== ACCOUNTABILITY REGISTER ===== -->
    <template v-if="tab === 'accountability'">
      <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UiStat label="Accountabilities" :value="accs.length" />
        <UiStat label="At risk" :value="atRisk" :tone="atRisk ? 'warning' : 'ink'" />
        <UiStat label="No owner" :value="unowned" :tone="unowned ? 'danger' : 'success'"
          hint="Vacant or shared seat" />
        <UiStat label="Functions covered" :value="functionCount" />
      </div>

      <div class="mb-3 flex flex-wrap items-center gap-2">
        <input v-model="search" placeholder="Search — e.g. who owns payroll"
          class="h-9 w-64 rounded-md border border-line bg-white px-3 text-[13px]">
        <select v-model="fnFilter" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px] font-medium">
          <option value="">All functions</option>
          <option v-for="f in functions" :key="f.key" :value="f.key">{{ f.name }}</option>
        </select>
        <label class="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
          <input v-model="unownedOnly" type="checkbox" class="h-3.5 w-3.5 accent-brown"> Gaps only
        </label>
      </div>

      <UiTable :columns="[
        { key: 'name', label: 'Accountability' },
        { key: 'owner', label: 'Accountable' },
        { key: 'metric', label: 'Metric / target' },
        { key: 'cadence', label: 'Cadence', width: '100px' },
        { key: 'status', label: 'Status', align: 'center', width: '100px' },
      ]">
        <tr v-for="a in filteredAccs" :key="a.key" class="border-b border-line-soft last:border-0 hover:bg-surface-sunken/50">
          <td class="px-3.5 py-2.5">
            <p class="font-semibold text-ink">{{ a.name }}</p>
            <p v-if="a.outcome" class="mt-0.5 max-w-lg text-[11.5px] leading-relaxed text-muted">{{ a.outcome }}</p>
            <p class="mt-0.5 font-mono text-[10.5px] text-line-strong">{{ a.key }}<span v-if="a.function"> · {{ a.function }}</span></p>
          </td>
          <td class="px-3.5 py-2.5">
            <template v-if="a.owner_resolved">
              <p class="font-semibold text-ink">{{ a.owner_name }}</p>
              <p v-if="a.owner_seat" class="text-[11.5px] text-muted">{{ a.owner_seat }}</p>
            </template>
            <template v-else>
              <UiBadge tone="danger">no owner</UiBadge>
              <p class="mt-0.5 max-w-xs text-[11.5px] leading-relaxed text-warning">{{ a.owner_warning }}</p>
            </template>
          </td>
          <td class="px-3.5 py-2.5">
            <span v-if="a.metric" class="tabular-nums">
              {{ a.metric.name }}
              <span class="text-muted"> · {{ a.metric.target }}{{ a.metric.unit }}</span>
            </span>
            <span v-else class="text-muted">—</span>
          </td>
          <td class="px-3.5 py-2.5 text-muted">{{ a.cadence }}</td>
          <td class="px-3.5 py-2.5 text-center">
            <UiBadge :tone="a.status === 'at_risk' ? 'warning' : a.status === 'active' ? 'success' : 'muted'">
              {{ a.status }}
            </UiBadge>
          </td>
        </tr>
        <tr v-if="!filteredAccs.length">
          <td colspan="5" class="px-3.5 py-8 text-center text-[13px] text-muted">Nothing matches those filters.</td>
        </tr>
      </UiTable>

      <div class="mt-4 rounded-lg border border-blue/30 bg-blue-soft p-4">
        <p class="text-[13px] font-semibold text-brown">One owner each, on purpose</p>
        <p class="mt-1 max-w-3xl text-[12px] leading-relaxed text-ink-soft">
          Ownership attaches to a <strong>seat</strong> rather than a person, so it survives someone leaving.
          The register resolves the seat to whoever holds it now — and tells you plainly when that seat is
          vacant or shared, because a shared accountability is nobody's. Contributors are tracked separately.
        </p>
        <NuxtLink to="/help/org-and-accountability" class="press mt-2 inline-block text-[12px] font-semibold text-brown underline decoration-brown/30">
          How the model works →
        </NuxtLink>
      </div>
    </template>

    <!-- ===== MY LINE ===== -->
    <template v-if="tab === 'mine'">
      <div v-if="reporting" class="grid gap-5 lg:grid-cols-2">
        <div class="rounded-lg border border-line-soft bg-white p-4 shadow-warm-sm">
          <p class="eyebrow">You</p>
          <p class="mt-0.5 font-display text-[20px] font-bold text-ink">{{ reporting.staff.display_name }}</p>
          <p class="text-[13px] text-ink-soft">
            {{ reporting.staff.display_title || '—' }}
            <span v-if="reporting.seat?.title && reporting.seat.title !== reporting.staff.display_title" class="text-muted">
              · {{ reporting.seat.title }}
            </span>
          </p>
          <p v-if="reporting.seat?.purpose" class="mt-2 text-[12px] leading-relaxed text-muted">
            {{ reporting.seat.purpose }}
          </p>

          <div class="mt-4 border-t border-line-soft pt-3">
            <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Reports to</p>
            <p v-if="reporting.manager" class="mt-0.5 text-[13.5px] text-ink">
              <NuxtLink :to="`/team/${reporting.manager.id}`" class="press font-semibold text-brown underline decoration-brown/25">
                {{ reporting.manager.display_name }}
              </NuxtLink>
              <span class="text-muted">· {{ reporting.manager.display_title }}</span>
            </p>
            <p v-else class="mt-0.5 text-[13px] text-muted">Top of the chart</p>
            <p v-if="reporting.manager_warning" class="mt-1 text-[11.5px] text-warning">{{ reporting.manager_warning }}</p>
          </div>

          <div v-if="reporting.reporting_chain?.length" class="mt-3 border-t border-line-soft pt-3">
            <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Chain up</p>
            <p class="mt-0.5 text-[12.5px] text-ink-soft">
              {{ reporting.reporting_chain.map((c) => c.display_name).join(' → ') }}
            </p>
          </div>
        </div>

        <div>
          <div class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
            <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">
              Direct reports ({{ reporting.direct_reports.length }})
            </p>
            <NuxtLink v-for="r in reporting.direct_reports" :key="r.id" :to="`/team/${r.id}`"
              class="press flex items-center gap-2.5 border-b border-line-soft px-3.5 py-2 last:border-0">
              <span class="flex h-6 w-6 items-center justify-center rounded-full bg-peach-soft text-[10px] font-bold text-brown">
                {{ initials(r.display_name) }}
              </span>
              <span class="flex-1 text-[13px] font-semibold text-ink">{{ r.display_name }}</span>
              <span class="text-[11.5px] text-muted">{{ r.display_title }}</span>
            </NuxtLink>
            <p v-if="!reporting.direct_reports.length" class="px-3.5 py-3 text-[12.5px] text-muted">No direct reports.</p>
          </div>

          <div class="mt-4 overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
            <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">
              You are accountable for ({{ reporting.accountabilities.length }})
            </p>
            <div v-for="a in reporting.accountabilities" :key="a.key"
              class="border-b border-line-soft px-3.5 py-2 last:border-0">
              <div class="flex items-center gap-2">
                <span class="flex-1 text-[13px] font-semibold text-ink">{{ a.name }}</span>
                <UiBadge :tone="a.status === 'at_risk' ? 'warning' : 'success'">{{ a.status }}</UiBadge>
              </div>
              <p v-if="a.outcome" class="mt-0.5 text-[11.5px] leading-relaxed text-muted">{{ a.outcome }}</p>
              <p v-if="a.metric" class="mt-0.5 text-[11.5px] tabular-nums text-ink-soft">
                {{ a.metric.name }}: target {{ a.metric.target }}{{ a.metric.unit }} · reviewed {{ a.cadence }}
              </p>
            </div>
            <p v-if="!reporting.accountabilities.length" class="px-3.5 py-3 text-[12.5px] text-muted">
              Nothing assigned to you in the register yet.
            </p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
const tabs = [
  { key: 'chart', label: 'Org chart' },
  { key: 'accountability', label: 'Accountability' },
  { key: 'mine', label: 'My line' },
]
const tab = ref('chart')

const search = ref('')
const fnFilter = ref('')
const unownedOnly = ref(false)

const { data: chartRes } = await useFetch<any>('/api/v1/org/chart', { lazy: true })
const chart = computed<any>(() => chartRes.value?.data)

const { data: accRes } = await useFetch<any>('/api/v1/accountabilities', { lazy: true })
const accs = computed<any[]>(() => accRes.value?.data || [])

const { data: posRes } = await useFetch<any>('/api/v1/org/positions', { lazy: true })
const functions = computed<any[]>(() => posRes.value?.functions || [])

const { data: reportingRes } = await useFetch<any>('/api/v1/org/reporting', { lazy: true })
const reporting = computed<any>(() => reportingRes.value?.data)

const vacancyCount = computed(() => {
  let n = 0
  const walk = (node: any) => { n += node.vacancies || 0; (node.children || []).forEach(walk) }
  ;(chart.value?.roots || []).forEach(walk)
  return n
})

const atRisk = computed(() => accs.value.filter((a) => a.status === 'at_risk').length)
const unowned = computed(() => accs.value.filter((a) => !a.owner_resolved).length)
const functionCount = computed(() => new Set(accs.value.map((a) => a.function).filter(Boolean)).size)

const filteredAccs = computed(() => {
  const q = search.value.trim().toLowerCase()
  return accs.value.filter((a) => {
    if (unownedOnly.value && a.owner_resolved) return false
    if (fnFilter.value) {
      const fn = functions.value.find((f) => f.key === fnFilter.value)
      if (fn && a.function !== fn.name) return false
    }
    if (!q) return true
    return [a.name, a.outcome, a.key, a.owner_name, a.owner_seat, a.metric?.name]
      .filter(Boolean).some((v: string) => v.toLowerCase().includes(q))
  })
})

function initials(name: string) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}
</script>
