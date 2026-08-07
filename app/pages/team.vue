<template>
  <div>
    <UiPageHeader eyebrow="People" title="Team"
      subtitle="Staff records sync to the POS register directory automatically. Termination revokes POS access; re-activation does not restore it.">
      <template #actions>
        <input v-model="search" placeholder="Search name or code"
          class="h-9 w-52 rounded-md border border-line bg-white px-2.5 text-[13px]">
        <select v-model="typeFilter" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px] font-medium">
          <option value="">All types</option>
          <option value="full_time">Full-time</option>
          <option value="part_time">Part-time</option>
        </select>
        <select v-model="statusFilter" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px] font-medium">
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="terminated">Terminated</option>
          <option value="">All</option>
        </select>
      </template>
    </UiPageHeader>

    <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <UiStat label="Active staff" :value="stats.active" />
      <UiStat label="Full-time" :value="stats.ft" />
      <UiStat label="Part-time" :value="stats.pt" hint="Scheduled from the pool" />
      <UiStat label="Managers" :value="stats.managers" hint="Supervisor and above" />
    </div>

    <UiTable :columns="columns">
      <tr v-for="m in team" :key="m.id" class="border-b border-line-soft last:border-0 hover:bg-surface-sunken/50">
        <td class="px-3.5 py-2.5">
          <div class="flex items-center gap-2.5">
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-peach-soft text-[11px] font-bold text-brown">
              {{ initials(m.display_name) }}
            </span>
            <div class="min-w-0">
              <p class="truncate text-[13px] font-semibold text-ink">{{ m.display_name }}</p>
              <p class="truncate text-[11.5px] text-muted">{{ m.email || m.phone || '—' }}</p>
            </div>
          </div>
        </td>
        <td class="px-3.5 py-2.5 font-mono text-[12px] text-muted">{{ m.employee_code }}</td>
        <td class="px-3.5 py-2.5">
          <p v-if="m.display_title" class="font-semibold text-ink">{{ m.display_title }}</p>
          <p v-if="m.title && m.title !== m.display_title" class="text-[11.5px] text-muted">{{ m.title }}</p>
          <p v-if="!m.display_title" class="text-[12px] italic text-warning">no seat</p>
        </td>
        <td class="px-3.5 py-2.5 text-muted">{{ roleLabel(m.role) }}</td>
        <td class="px-3.5 py-2.5">
          <UiBadge :tone="m.employment_type === 'part_time' ? 'accent' : 'muted'">
            {{ m.employment_type === 'part_time' ? 'PT' : 'FT' }}
          </UiBadge>
        </td>
        <td class="px-3.5 py-2.5 text-[12px] text-muted">{{ m.home_store?.code || '—' }}</td>
        <td class="px-3.5 py-2.5 text-right tabular-nums text-muted">
          {{ m.pt_weekly_hour_cap ? `${m.pt_weekly_hour_cap}h/wk` : '—' }}
        </td>
        <td v-if="isAreaManager" class="px-3.5 py-2.5 text-right tabular-nums">
          {{ m.hourly_rate_cents ? `$${(m.hourly_rate_cents / 100).toFixed(2)}` : '—' }}
        </td>
        <td class="px-3.5 py-2.5 text-center">
          <UiBadge :tone="m.employment_status === 'active' ? 'success' : 'danger'">{{ m.employment_status }}</UiBadge>
        </td>
      </tr>
      <tr v-if="!team.length">
        <td :colspan="columns.length" class="px-3.5 py-8 text-center text-[13px] text-muted">No staff match those filters.</td>
      </tr>
    </UiTable>

    <p class="mt-2 text-[11.5px] text-muted">
      Adding or editing staff requires an area manager and is done via the API — see the project README.
      Pay rates are visible to area managers and above only.
    </p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['supervisor-only'] })

const { isAreaManager } = useSession()

const search = ref('')
const typeFilter = ref('')
const statusFilter = ref('active')

const { data: res } = await useFetch<any>('/api/v1/staff', {
  query: computed(() => ({
    limit: 100,
    search: search.value || undefined,
    employment_type: typeFilter.value || undefined,
    employment_status: statusFilter.value || undefined,
  })),
  watch: [search, typeFilter, statusFilter],
})
const team = computed<any[]>(() => res.value?.data || [])

const columns = computed(() => {
  const cols: any[] = [
    { key: 'name', label: 'Name' },
    { key: 'code', label: 'Code', width: '90px' },
    { key: 'title', label: 'Title' },
    { key: 'role', label: 'Access role' },
    { key: 'type', label: 'Type', width: '70px' },
    { key: 'store', label: 'Store', width: '80px' },
    { key: 'cap', label: 'PT cap', align: 'right' },
  ]
  if (isAreaManager.value) cols.push({ key: 'rate', label: 'Rate', align: 'right' })
  cols.push({ key: 'status', label: 'Status', align: 'center', width: '100px' })
  return cols
})

const stats = computed(() => {
  const rows = team.value
  return {
    active: rows.filter((r) => r.employment_status === 'active').length,
    ft: rows.filter((r) => r.employment_type === 'full_time').length,
    pt: rows.filter((r) => r.employment_type === 'part_time').length,
    managers: rows.filter((r) => ['supervisor', 'store_manager', 'area_manager', 'hq_admin'].includes(r.role)).length,
  }
})

function initials(name: string) {
  return name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}
function roleLabel(role: string) {
  return ({
    staff: 'Staff', supervisor: 'Supervisor', store_manager: 'Store Manager',
    area_manager: 'Area Manager', hq_admin: 'HQ Admin',
  } as Record<string, string>)[role] || role
}
</script>
