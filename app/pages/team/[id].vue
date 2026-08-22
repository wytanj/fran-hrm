<template>
  <div>
    <UiPageHeader eyebrow="People" :title="staff?.display_name || 'Staff'"
      :subtitle="headerSubtitle">
      <template #actions>
        <NuxtLink to="/team" class="press text-[12.5px] font-semibold text-brown">← Team</NuxtLink>
        <UiButton v-if="canEdit && !editing" size="sm" variant="secondary" @click="startEdit">Edit</UiButton>
        <template v-if="editing">
          <UiButton size="sm" variant="ghost" :disabled="saving" @click="editing = false">Cancel</UiButton>
          <UiButton size="sm" :loading="saving" @click="save">Save</UiButton>
        </template>
      </template>
    </UiPageHeader>

    <UiBusy :busy="pending" label="Loading profile…">
    <div v-if="error" class="rounded-lg border border-danger/30 bg-danger-soft p-4 text-[13px] text-danger">
      {{ error }}
    </div>
    <template v-else-if="staff">
      <!-- Identity strip -->
      <div class="mb-5 flex flex-wrap items-start gap-4 rounded-lg border border-line-soft bg-white p-4 shadow-warm-sm">
        <span class="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-peach-soft text-[15px] font-bold text-brown">
          {{ initials(staff.display_name) }}
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <p class="font-display text-[22px] font-bold leading-7 text-ink">{{ staff.display_name }}</p>
            <UiDummyTag :show="staff.is_dummy" />
            <UiAccessTag v-if="!staff.is_dummy" :method="staff.access_method" />
            <UiBadge :tone="staff.employment_status === 'active' ? 'success' : 'danger'">{{ staff.employment_status }}</UiBadge>
            <UiBadge :tone="empTypeTone(staff.employment_type)">{{ empTypeName(staff.employment_type) }}</UiBadge>
          </div>
          <p class="mt-0.5 text-[13px] text-ink-soft">
            <span class="font-mono text-[12px] text-muted">{{ staff.employee_code }}</span>
            <span v-if="staff.display_title"> · {{ staff.display_title }}</span>
            <span v-if="staff.title && staff.title !== staff.display_title" class="text-muted"> · {{ staff.title }}</span>
            <span v-if="staff.home_store"> · {{ staff.home_store.name }}</span>
          </p>
          <div v-if="staff.departments?.length" class="mt-2 flex flex-wrap gap-1.5">
            <UiBadge v-for="d in staff.departments" :key="d.key" :tone="d.is_primary ? 'primary' : 'muted'">
              {{ d.name }}<span v-if="d.source === 'seat'" class="normal-case tracking-normal opacity-70"> · from seat</span>
            </UiBadge>
          </div>
        </div>
      </div>

      <div class="grid gap-5 lg:grid-cols-5">
        <!-- Hierarchy -->
        <div class="lg:col-span-2 space-y-4">
          <section class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
            <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Reports to</p>
            <div class="px-3.5 py-3">
              <NuxtLink v-if="hierarchy?.manager" :to="`/team/${hierarchy.manager.id}`"
                class="press flex items-center gap-2.5">
                <span class="flex h-7 w-7 items-center justify-center rounded-full bg-peach-soft text-[11px] font-bold text-brown">
                  {{ initials(hierarchy.manager.display_name) }}
                </span>
                <span class="min-w-0">
                  <span class="block text-[13px] font-semibold text-ink">{{ hierarchy.manager.display_name }}</span>
                  <span class="block text-[11.5px] text-muted">{{ hierarchy.manager.display_title || '—' }}</span>
                </span>
              </NuxtLink>
              <p v-else class="text-[13px] text-muted">{{ hierarchy?.manager_source === 'top_of_chart' ? 'Top of the chart' : 'No manager set' }}</p>
              <p v-if="hierarchy?.manager_warning" class="mt-1.5 text-[11.5px] leading-relaxed text-warning">{{ hierarchy.manager_warning }}</p>
            </div>
            <div v-if="hierarchy?.reporting_chain?.length" class="border-t border-line-soft px-3.5 py-2.5">
              <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Chain up</p>
              <p class="mt-0.5 text-[12.5px] text-ink-soft">
                {{ hierarchy.reporting_chain.map((c: any) => c.display_name).join(' → ') }}
              </p>
            </div>
          </section>

          <section class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
            <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">
              Direct reports ({{ hierarchy?.direct_reports?.length || 0 }})
            </p>
            <NuxtLink v-for="r in hierarchy?.direct_reports || []" :key="r.id" :to="`/team/${r.id}`"
              class="press flex items-center gap-2.5 border-b border-line-soft px-3.5 py-2 last:border-0">
              <span class="flex h-6 w-6 items-center justify-center rounded-full bg-peach-soft text-[10px] font-bold text-brown">
                {{ initials(r.display_name) }}
              </span>
              <span class="flex-1 text-[13px] font-semibold text-ink">{{ r.display_name }}</span>
              <span class="text-[11.5px] text-muted">{{ r.display_title }}</span>
            </NuxtLink>
            <p v-if="!hierarchy?.direct_reports?.length" class="px-3.5 py-3 text-[12.5px] text-muted">No direct reports.</p>
          </section>

          <section v-if="hierarchy?.accountabilities?.length" class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
            <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">
              Accountable for
            </p>
            <div v-for="a in hierarchy.accountabilities" :key="a.key" class="border-b border-line-soft px-3.5 py-2 last:border-0">
              <p class="text-[13px] font-semibold text-ink">{{ a.name }}</p>
              <p v-if="a.outcome" class="mt-0.5 text-[11.5px] leading-relaxed text-muted">{{ a.outcome }}</p>
            </div>
          </section>
        </div>

        <!-- Field groups -->
        <div class="lg:col-span-3 space-y-4">
          <p v-if="!canSeeSensitive" class="rounded-lg border border-line bg-surface-sunken px-3.5 py-2.5 text-[12px] text-ink-soft">
            Pay, citizenship, race, home address and NRIC need
            <strong>See pay rates and manpower cost</strong> or <strong>Create and edit staff records</strong>.
          </p>

          <section v-for="group in visibleGroups" :key="group.key"
            class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
            <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">
              {{ group.label }}
            </p>

            <!-- Departments (org group) -->
            <div v-if="group.key === 'org'" class="border-b border-line-soft px-3.5 py-2.5">
              <p class="mb-1.5 text-[11px] font-semibold text-ink-soft">Departments</p>
              <div v-if="editing" class="space-y-1.5">
                <label v-for="fn in functions" :key="fn.key" class="flex items-center gap-2 text-[13px]">
                  <input type="checkbox" class="h-3.5 w-3.5 accent-brown" :checked="form.deptKeys.includes(fn.key)"
                    @change="toggleDept(fn.key, ($event.target as HTMLInputElement).checked)">
                  <span class="flex-1 text-ink">{{ fn.name }}</span>
                  <label v-if="form.deptKeys.includes(fn.key)" class="flex items-center gap-1 text-[11.5px] text-muted">
                    <input type="radio" class="accent-brown" :checked="form.primaryDept === fn.key" @change="form.primaryDept = fn.key">
                    primary
                  </label>
                </label>
                <p class="text-[11.5px] text-muted">Leave all unchecked to inherit the seat’s function.</p>
              </div>
              <div v-else class="flex flex-wrap gap-1.5">
                <UiBadge v-for="d in staff.departments || []" :key="d.key" :tone="d.is_primary ? 'primary' : 'muted'">{{ d.name }}</UiBadge>
                <span v-if="!staff.departments?.length" class="text-[13px] text-muted">None</span>
              </div>
            </div>

            <div class="divide-y divide-line-soft">
              <div v-for="f in group.fields" :key="f.key" class="grid grid-cols-1 gap-1 px-3.5 py-2 sm:grid-cols-3 sm:items-center">
                <p class="text-[12px] font-semibold text-ink-soft">{{ f.label }}</p>
                <div class="sm:col-span-2">
                  <template v-if="editing && f.writable && !f.create_only">
                    <select v-if="f.type === 'enum' || f.type === 'store_ref' || f.type === 'position_ref' || f.type === 'staff_ref'"
                      v-model="form.values[f.key]"
                      class="h-8 w-full rounded-md border border-line bg-white px-2 text-[13px]">
                      <option :value="null">—</option>
                      <option v-for="opt in refOptions(f)" :key="opt.value" :value="opt.value">{{ opt.label }}</option>
                    </select>
                    <input v-else-if="f.type === 'date'" v-model="form.values[f.key]" type="date"
                      class="h-8 w-full rounded-md border border-line bg-white px-2 text-[13px]">
                    <select v-else-if="f.type === 'boolean'" v-model="form.values[f.key]"
                      class="h-8 w-full rounded-md border border-line bg-white px-2 text-[13px]">
                      <option :value="null">—</option>
                      <option :value="true">Yes</option>
                      <option :value="false">No</option>
                    </select>
                    <input v-else-if="f.type === 'money_cents'" v-model.number="form.values[f.key]" type="number" min="0" step="0.01"
                      class="h-8 w-full rounded-md border border-line bg-white px-2 text-right text-[13px] tabular-nums"
                      :placeholder="'0.00'">
                    <input v-else-if="f.type === 'number'" v-model.number="form.values[f.key]" type="number" step="0.01"
                      class="h-8 w-full rounded-md border border-line bg-white px-2 text-[13px]">
                    <input v-else v-model="form.values[f.key]" type="text"
                      class="h-8 w-full rounded-md border border-line bg-white px-2 text-[13px]">
                  </template>
                  <p v-else-if="!f.visible" class="text-[13px] italic text-muted">Hidden</p>
                  <p v-else class="text-[13px] text-ink">{{ displayValue(f) }}</p>
                </div>
              </div>
            </div>
          </section>

          <section v-if="editing && canEdit" class="rounded-lg border border-line-soft bg-white p-3.5 shadow-warm-sm">
            <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Reset PIN</p>
            <input v-model="form.pin" inputmode="numeric" placeholder="leave blank to keep"
              class="mt-1.5 h-8 w-40 rounded-md border border-line bg-white px-2 text-[13px]">
            <p class="mt-1 text-[11.5px] text-muted">4–12 digits. Stored hashed — it cannot be read back.</p>
          </section>

          <p v-if="saveMsg" class="text-[12.5px]" :class="saveErr ? 'text-danger' : 'text-success'">{{ saveMsg }}</p>

          <div v-if="canEdit && !editing" class="flex flex-wrap gap-2">
            <UiButton v-if="staff.employment_status !== 'terminated' && !staff.is_dummy" size="sm" variant="secondary"
              :loading="acting" @click="terminate">Terminate</UiButton>
            <UiButton v-if="staff.is_dummy" size="sm" variant="secondary" :loading="viewingAsBusy" @click="viewAsThisDummy">View as</UiButton>
            <UiButton v-if="staff.is_dummy" size="sm" variant="danger" :loading="acting" @click="purge">Delete dummy</UiButton>
          </div>
        </div>
      </div>
    </template>
    </UiBusy>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['supervisor-only'] })

const route = useRoute()
const id = computed(() => String(route.params.id))

const { data: res, pending, error: fetchErr, refresh } = await useFetch<any>(() => `/api/v1/staff/${id.value}`, {
  watch: [id],
})
const staff = computed<any>(() => res.value?.data || null)
const hierarchy = computed<any>(() => staff.value?.hierarchy || null)
const canEdit = computed(() => !!staff.value?.can_edit)
const canSeeSensitive = computed(() => !!staff.value?.can_see_sensitive)
const error = computed(() => {
  const e: any = fetchErr.value
  return e?.data?.message || e?.data?.statusMessage || (e ? 'Could not load this staff record.' : '')
})

const { data: posRes } = await useFetch<any>('/api/v1/org/positions', { lazy: true })
const functions = computed<any[]>(() => posRes.value?.functions || [])
const positions = computed<any[]>(() => posRes.value?.data || [])

const { data: teamRes } = await useFetch<any>('/api/v1/staff', {
  query: { limit: 100, employment_status: 'active' }, lazy: true,
})
const teammates = computed<any[]>(() => (teamRes.value?.data || []).filter((m: any) => m.id !== id.value))

const { data: storesRes } = await useFetch<any>('/api/v1/stores', { lazy: true })
const stores = computed<any[]>(() => storesRes.value?.data || [])

const FIELD_GROUP_ORDER = ['identity', 'employment', 'org', 'contact', 'address', 'statutory', 'compensation', 'custom']
const GROUP_LABELS: Record<string, string> = {
  identity: 'Identity', employment: 'Employment', org: 'Org & hierarchy',
  contact: 'Contact', address: 'Home address', statutory: 'Statutory (Singapore)',
  compensation: 'Pay', custom: 'Custom',
}

const visibleGroups = computed(() => {
  const fields = (staff.value?.fields || []).filter((f: any) => {
    if (editing.value && canEdit.value) return true
    return f.visible !== false
  })
  const by: Record<string, any[]> = {}
  for (const f of fields) {
    const g = f.group || 'custom'
    ;(by[g] ||= []).push(f)
  }
  return FIELD_GROUP_ORDER.filter((k) => by[k]?.length).map((k) => ({
    key: k, label: GROUP_LABELS[k] || k, fields: by[k],
  }))
})

const headerSubtitle = computed(() => {
  if (!staff.value) return 'Staff profile'
  const bits = [staff.value.display_title, staff.value.employee_code].filter(Boolean)
  return bits.join(' · ')
})

const editing = ref(false)
const saving = ref(false)
const acting = ref(false)
const { viewAs } = useSession()
const viewingAsBusy = ref(false)
async function viewAsThisDummy() {
  viewingAsBusy.value = true
  try {
    await viewAs(id.value)
  } catch (err: any) {
    saveErr.value = true
    saveMsg.value = err?.data?.message || err?.data?.statusMessage || 'Could not switch'
    viewingAsBusy.value = false
  }
}
const saveMsg = ref('')
const saveErr = ref(false)
const form = reactive<{ values: Record<string, any>; deptKeys: string[]; primaryDept: string; pin: string }>({
  values: {}, deptKeys: [], primaryDept: '', pin: '',
})

function startEdit() {
  const s = staff.value
  if (!s) return
  const values: Record<string, any> = {}
  for (const f of s.fields || []) {
    if (f.type === 'money_cents') values[f.key] = f.value != null ? Number(f.value) / 100 : null
    else values[f.key] = f.value ?? null
  }
  const explicit = (s.departments || []).filter((d: any) => d.source === 'explicit')
  form.values = values
  form.deptKeys = explicit.map((d: any) => d.key)
  form.primaryDept = (explicit.find((d: any) => d.is_primary) || explicit[0])?.key || ''
  form.pin = ''
  saveMsg.value = ''
  editing.value = true
}

function toggleDept(key: string, on: boolean) {
  if (on) {
    if (!form.deptKeys.includes(key)) form.deptKeys.push(key)
    if (!form.primaryDept) form.primaryDept = key
  } else {
    form.deptKeys = form.deptKeys.filter((k) => k !== key)
    if (form.primaryDept === key) form.primaryDept = form.deptKeys[0] || ''
  }
}

function refOptions(f: any) {
  if (f.type === 'enum') return (f.options || []).map((o: any) => typeof o === 'string' ? { value: o, label: o } : o)
  if (f.type === 'store_ref') return stores.value.map((s: any) => ({ value: s.id, label: `${s.name} (${s.code})` }))
  if (f.type === 'position_ref') return positions.value.map((p: any) => ({ value: p.id, label: `${p.display_title || p.title} (${p.code})` }))
  if (f.type === 'staff_ref') return teammates.value.map((m: any) => ({ value: m.id, label: `${m.display_name} (${m.employee_code})` }))
  return []
}

function displayValue(f: any) {
  if (f.display) return f.display
  if (f.value == null || f.value === '') return '—'
  if (f.type === 'store_ref') {
    const s = stores.value.find((x: any) => x.id === f.value)
    return s ? s.name : f.value
  }
  if (f.type === 'position_ref') {
    const p = positions.value.find((x: any) => x.id === f.value)
    return p ? (p.display_title || p.title) : f.value
  }
  if (f.type === 'staff_ref') {
    const m = teammates.value.find((x: any) => x.id === f.value)
    if (m) return m.display_name
    if (f.key === 'reports_to_id' && hierarchy.value?.manager) return hierarchy.value.manager.display_name
    return f.value
  }
  if (f.type === 'money_cents') return money(f.value)
  return String(f.value)
}

async function save() {
  saving.value = true; saveMsg.value = ''; saveErr.value = false
  try {
    const body: Record<string, any> = { custom: {} }
    for (const f of staff.value?.fields || []) {
      if (!f.writable || f.create_only) continue
      let v = form.values[f.key]
      if (v === '' || v === undefined) v = null
      if (f.type === 'money_cents' && v != null && v !== '') v = Math.round(Number(v) * 100)
      if (f.source === 'custom') body.custom[f.key] = v
      else body[f.key] = v
    }
    body.departments = form.deptKeys.map((k) => ({ key: k, is_primary: k === form.primaryDept }))
    if (form.pin.trim()) body.pin = form.pin.trim()
    await $fetch(`/api/v1/staff/${id.value}`, { method: 'PATCH', body })
    saveMsg.value = 'Saved'
    editing.value = false
    await refresh()
  } catch (err: any) {
    saveErr.value = true
    saveMsg.value = err?.data?.message || err?.data?.statusMessage || 'Could not save'
  } finally { saving.value = false }
}

async function terminate() {
  if (!confirm(`Terminate ${staff.value.display_name}? Their timesheets stay; they can no longer sign in.`)) return
  acting.value = true; saveMsg.value = ''; saveErr.value = false
  try {
    await $fetch(`/api/v1/staff/${id.value}`, { method: 'DELETE', query: { mode: 'terminate' } })
    await refresh()
    saveMsg.value = 'Terminated'
  } catch (err: any) {
    saveErr.value = true
    saveMsg.value = err?.data?.message || err?.data?.statusMessage || 'Failed'
  } finally { acting.value = false }
}

async function purge() {
  if (!confirm(`Permanently delete dummy ${staff.value.display_name}?`)) return
  acting.value = true
  try {
    await $fetch(`/api/v1/staff/${id.value}`, { method: 'DELETE', query: { mode: 'purge' } })
    await navigateTo('/team')
  } catch (err: any) {
    saveErr.value = true
    saveMsg.value = err?.data?.message || err?.data?.statusMessage || 'Failed'
    acting.value = false
  }
}

function initials(name: string) {
  return String(name || '').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()
}
</script>
