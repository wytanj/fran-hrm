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
          <option value="contractor">Contractor</option>
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

    <UiBusy :busy="pending" label="Loading team…">
    <UiTable :columns="columns">
      <tr v-for="m in team" :key="m.id" class="border-b border-line-soft last:border-0 hover:bg-surface-sunken/50">
        <td class="px-3.5 py-2.5">
          <div class="flex items-center gap-2.5">
            <span class="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-peach-soft text-[11px] font-bold text-brown">
              {{ initials(m.display_name) }}
            </span>
            <div class="min-w-0">
              <p class="truncate text-[13px] font-semibold text-ink">{{ m.display_name }}<UiDummyTag :show="m.is_dummy" /><UiAccessTag v-if="!m.is_dummy" :method="m.access_method" /></p>
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
          <UiBadge :tone="empTypeTone(m.employment_type)">{{ empTypeShort(m.employment_type) }}</UiBadge>
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
    </UiBusy>

    <p class="mt-2 text-[11.5px] text-muted">Pay rates are visible to area managers and above only.</p>

    <!-- Add staff directly (no Google SSO needed) — area manager+ -->
    <div v-if="isAreaManager" class="mt-6 rounded-lg border border-line bg-white p-4 shadow-warm-xs">
      <h3 class="font-display text-[15px] font-bold text-ink">Add staff</h3>
      <p class="mt-1 text-[12px] text-muted">
        Create an employee directly — no Google invite required. Give a PIN if they'll clock in / sign in; leave the code blank to auto-generate.
        Admins/managers/finance can also sign in with Google later using their email.
      </p>
      <div class="mt-3 flex flex-wrap items-end gap-2.5">
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Name</span>
          <input v-model="newStaff.name" placeholder="Full name" class="h-9 w-44 rounded-md border border-line bg-white px-2.5 text-[13px]">
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Code</span>
          <input v-model="newStaff.code" placeholder="auto" class="h-9 w-24 rounded-md border border-line bg-white px-2.5 font-mono text-[12px]">
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Role</span>
          <select v-model="newStaff.role" class="h-9 rounded-md border border-line bg-white px-2 text-[13px]">
            <option value="staff">Staff</option>
            <option value="supervisor">Supervisor</option>
            <option value="store_manager">Store Manager</option>
            <option value="area_manager">Area Manager</option>
            <option value="finance">Finance</option>
            <option value="hq_admin">HQ Admin</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Type</span>
          <select v-model="newStaff.type" class="h-9 rounded-md border border-line bg-white px-2 text-[13px]">
            <option value="full_time">Full-time</option>
            <option value="part_time">Part-time</option>
            <option value="contractor">Contractor</option>
          </select>
        </label>
        <label v-if="stores.length" class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Store</span>
          <select v-model="newStaff.store" class="h-9 rounded-md border border-line bg-white px-2 text-[13px]">
            <option value="">—</option>
            <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
          </select>
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Email</span>
          <input v-model="newStaff.email" type="email" placeholder="optional" class="h-9 w-48 rounded-md border border-line bg-white px-2.5 text-[13px]">
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">PIN</span>
          <input v-model="newStaff.pin" inputmode="numeric" placeholder="optional" class="h-9 w-24 rounded-md border border-line bg-white px-2.5 text-[13px]">
        </label>
        <UiButton size="sm" :loading="addingStaff" :disabled="!newStaff.name.trim()" @click="createStaff">Add staff</UiButton>
        <span v-if="staffMsg" class="text-[12px]" :class="staffErr ? 'text-danger' : 'text-success'">{{ staffMsg }}</span>
      </div>
    </div>

    <!-- Invite a teammate (Google SSO) — area manager+ -->
    <div v-if="isAreaManager" class="mt-6 rounded-lg border border-line bg-white p-4 shadow-warm-xs">
      <h3 class="font-display text-[15px] font-bold text-ink">Invite a teammate</h3>
      <p class="mt-1 text-[12px] text-muted">
        They join this workspace when they sign in with Google using this email — no link needed. For managers, finance and admins; floor staff use a PIN.
      </p>
      <div class="mt-3 flex flex-wrap items-end gap-2.5">
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Email</span>
          <input v-model="invite.email" type="email" placeholder="name@heyfran.com"
            class="h-9 w-60 rounded-md border border-line bg-white px-2.5 text-[13px]">
        </label>
        <label class="block">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Role</span>
          <select v-model="invite.role" class="h-9 rounded-md border border-line bg-white px-2 text-[13px]">
            <option value="staff">Staff</option>
            <option value="supervisor">Supervisor</option>
            <option value="store_manager">Store Manager</option>
            <option value="area_manager">Area Manager</option>
            <option value="finance">Finance</option>
            <option value="hq_admin">HQ Admin</option>
          </select>
        </label>
        <UiButton size="sm" :loading="inviting" :disabled="!invite.email.includes('@')" @click="sendInvite">Send invite</UiButton>
        <span v-if="inviteMsg" class="text-[12px]" :class="inviteErr ? 'text-danger' : 'text-success'">{{ inviteMsg }}</span>
      </div>
      <div v-if="invites.length" class="mt-3">
        <p class="mb-1 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Pending invites</p>
        <div v-for="i in invites" :key="i.id" class="flex items-center gap-2 border-b border-line-soft py-1.5 last:border-0 text-[12.5px]">
          <span class="font-semibold text-ink">{{ i.email }}</span>
          <UiBadge tone="muted">{{ roleLabel(i.role) }}</UiBadge>
          <UiBadge v-if="i.expired" tone="danger">expired</UiBadge>
          <span class="text-[11px] text-muted">invited by {{ i.invited_by || '—' }}</span>
          <button class="press ml-auto text-[12px] font-semibold text-danger" @click="revokeInvite(i)">Revoke</button>
        </div>
      </div>
    </div>

    <!-- Simulated staff: model a prospective hire or seed test data (area manager+) -->
    <div v-if="isAreaManager" class="mt-6 rounded-lg border border-dashed border-brown/30 bg-peach-soft/40 p-4">
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="font-display text-[15px] font-bold text-ink">Simulated staff</h3>
        <UiDummyTag :show="true" />
        <span class="text-[12px] text-muted">Model a prospective hire — or seed test data. Tagged everywhere and left out of real hours/cost; purge when done.</span>
        <button class="press ml-auto text-[12.5px] font-semibold text-brown" @click="showTesting = !showTesting">
          {{ showTesting ? 'Hide' : 'Open' }}
        </button>
      </div>

      <div v-if="showTesting" class="mt-3">
        <div class="flex flex-wrap items-end gap-2.5 rounded-md border border-line bg-white p-3">
          <label class="block">
            <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Name</span>
            <input v-model="dummy.name" placeholder="Test Person"
              class="h-9 w-44 rounded-md border border-line bg-white px-2.5 text-[13px]">
          </label>
          <label class="block">
            <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Role</span>
            <select v-model="dummy.role" class="h-9 rounded-md border border-line bg-white px-2 text-[13px]">
              <option value="staff">Staff</option>
              <option value="supervisor">Supervisor</option>
              <option value="store_manager">Store Manager</option>
              <option value="area_manager">Area Manager</option>
              <option value="hq_admin">HQ Admin</option>
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Type</span>
            <select v-model="dummy.type" class="h-9 rounded-md border border-line bg-white px-2 text-[13px]">
              <option value="full_time">Full-time</option>
              <option value="part_time">Part-time</option>
              <option value="contractor">Contractor</option>
            </select>
          </label>
          <label v-if="stores.length" class="block">
            <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Store</span>
            <select v-model="dummy.store" class="h-9 rounded-md border border-line bg-white px-2 text-[13px]">
              <option value="">—</option>
              <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
          </label>
          <UiButton size="sm" :loading="creating" :disabled="!dummy.name.trim()" @click="createDummy">Create dummy</UiButton>
          <span class="text-[11px] text-muted">Signs in with the created code · PIN 123456</span>
        </div>

        <div v-if="dummies.length" class="mt-3 overflow-hidden rounded-md border border-line bg-white">
          <div class="flex items-center gap-2 border-b border-line-soft px-3 py-2">
            <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">{{ dummies.length }} dummy staff</p>
            <button class="press ml-auto rounded-md border border-danger/40 px-2.5 py-1 text-[12px] font-semibold text-danger" :disabled="busy" @click="purgeAll">
              Remove all dummies
            </button>
          </div>
          <div v-for="m in dummies" :key="m.id" class="flex items-center gap-2 border-b border-line-soft px-3 py-1.5 last:border-0 text-[12.5px]">
            <span class="font-semibold text-ink">{{ m.display_name }}</span>
            <span class="font-mono text-[11px] text-muted">{{ m.employee_code }}</span>
            <span class="text-[11px] text-muted">{{ roleLabel(m.role) }}</span>
            <button class="press ml-auto text-[12px] font-semibold text-danger" :disabled="busy" @click="removeDummy(m)">Remove</button>
          </div>
        </div>
        <p v-else class="mt-2 text-[12px] text-muted">No dummy staff yet.</p>
        <p v-if="testMsg" class="mt-2 text-[12px]" :class="testErr ? 'text-danger' : 'text-success'">{{ testMsg }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['supervisor-only'] })

const { isAreaManager } = useSession()

const search = ref('')
const typeFilter = ref('')
const statusFilter = ref('active')

const { data: res, pending, refresh } = await useFetch<any>('/api/v1/staff', {
  query: computed(() => ({
    limit: 100,
    search: search.value || undefined,
    employment_type: typeFilter.value || undefined,
    employment_status: statusFilter.value || undefined,
  })),
  watch: [search, typeFilter, statusFilter], lazy: true,
})
const team = computed<any[]>(() => res.value?.data || [])

// ── testing tools: dummy staff ──
const { data: storesRes } = await useFetch<any>('/api/v1/stores', { lazy: true })
const stores = computed<any[]>(() => (storesRes.value?.data || []).filter((s: any) => s.kind === 'store'))
const dummies = computed<any[]>(() => team.value.filter((m) => m.is_dummy))

// Add real staff directly (no Google SSO invite required)
const newStaff = reactive({ name: '', code: '', role: 'staff', type: 'full_time', store: '', email: '', pin: '' })
const addingStaff = ref(false)
const staffMsg = ref('')
const staffErr = ref(false)
async function createStaff() {
  addingStaff.value = true; staffMsg.value = ''; staffErr.value = false
  try {
    const r: any = await $fetch('/api/v1/staff', {
      method: 'POST',
      body: {
        display_name: newStaff.name.trim(),
        employee_code: newStaff.code.trim() || undefined,
        role: newStaff.role,
        employment_type: newStaff.type,
        home_store_id: newStaff.store || undefined,
        email: newStaff.email.trim() || undefined,
        pin: newStaff.pin.trim() || undefined,
      },
    })
    staffMsg.value = `Added ${r.data?.display_name} (${r.data?.employee_code})`
    newStaff.name = ''; newStaff.code = ''; newStaff.email = ''; newStaff.pin = ''
    await refresh()
  } catch (err: any) { staffErr.value = true; staffMsg.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { addingStaff.value = false }
}

// Invites (area manager+ only — the fetch is gated so supervisors don't 403)
const { data: invitesRes, refresh: refreshInvites } = await useFetch<any>('/api/v1/workspace-invites', {
  lazy: true, default: () => ({ data: [] }), immediate: computed(() => isAreaManager.value) as any,
})
const invites = computed<any[]>(() => invitesRes.value?.data || [])
const invite = reactive({ email: '', role: 'staff' })
const inviting = ref(false)
const inviteMsg = ref('')
const inviteErr = ref(false)
async function sendInvite() {
  inviting.value = true; inviteMsg.value = ''; inviteErr.value = false
  try {
    const r: any = await $fetch('/api/v1/workspace-invites', { method: 'POST', body: { email: invite.email.trim(), role: invite.role } })
    inviteMsg.value = r.note || 'Invited.'
    invite.email = ''
    await refreshInvites()
  } catch (err: any) { inviteErr.value = true; inviteMsg.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { inviting.value = false }
}
async function revokeInvite(i: any) {
  await $fetch(`/api/v1/workspace-invites/${i.id}`, { method: 'DELETE' }).catch(() => {})
  await refreshInvites()
}

const showTesting = ref(false)
const creating = ref(false)
const busy = ref(false)
const testMsg = ref('')
const testErr = ref(false)
const dummy = reactive({ name: '', role: 'staff', type: 'full_time', store: '' })

async function createDummy() {
  creating.value = true; testMsg.value = ''; testErr.value = false
  try {
    const r: any = await $fetch('/api/v1/staff', {
      method: 'POST',
      body: {
        is_dummy: true,
        display_name: dummy.name.trim(),
        role: dummy.role,
        employment_type: dummy.type,
        home_store_id: dummy.store || undefined,
      },
    })
    dummy.name = ''
    testMsg.value = `Created ${r.data?.display_name} (${r.data?.employee_code}) · PIN 123456`
    await refresh()
  } catch (err: any) { testErr.value = true; testMsg.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { creating.value = false }
}

async function removeDummy(m: any) {
  busy.value = true; testMsg.value = ''; testErr.value = false
  try {
    await $fetch(`/api/v1/staff/${m.id}`, { method: 'DELETE' })
    testMsg.value = `Removed ${m.employee_code}`
    await refresh()
  } catch (err: any) { testErr.value = true; testMsg.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { busy.value = false }
}

async function purgeAll() {
  busy.value = true; testMsg.value = ''; testErr.value = false
  try {
    const r: any = await $fetch('/api/v1/staff/purge-dummies', { method: 'POST' })
    testMsg.value = `Removed ${r.removed} dummy staff`
    await refresh()
  } catch (err: any) { testErr.value = true; testMsg.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { busy.value = false }
}

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
