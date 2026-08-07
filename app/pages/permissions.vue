<template>
  <div>
    <UiPageHeader eyebrow="Admin" title="Permissions"
      subtitle="What each role may do, and individual exceptions. Applies to the web app and to Claude — there is one set of rules.">
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

    <div v-if="!canEdit" class="mb-4 rounded-lg border border-line bg-surface-sunken p-3.5">
      <p class="text-[12.5px] text-ink-soft">
        This is what your account can currently do. Changing anyone's permissions needs the
        "Create and edit staff records" permission — ask an HQ admin.
      </p>
    </div>

    <!-- ===== ROLE MATRIX ===== -->
    <template v-if="tab === 'matrix'">
      <div v-for="group in groups" :key="group.name" class="mb-5">
        <h2 class="mb-2 font-display text-[16px] font-bold text-ink">{{ group.name }}</h2>
        <div class="overflow-x-auto rounded-lg border border-line-soft bg-white shadow-warm-sm">
          <table class="w-full min-w-[820px] text-left text-[13px]">
            <thead>
              <tr class="border-b border-line bg-surface-sunken/60">
                <th class="px-3.5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.5px] text-muted">Permission</th>
                <th v-for="r in roles" :key="r.role"
                  class="w-[110px] border-l border-line-soft px-2 py-2.5 text-center text-[10.5px] font-semibold uppercase tracking-[0.5px] text-muted">
                  {{ r.label }}
                </th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="s in group.scopes" :key="s.scope" class="border-b border-line-soft last:border-0">
                <td class="px-3.5 py-2.5">
                  <div class="flex items-center gap-2">
                    <p class="font-semibold text-ink">{{ s.label }}</p>
                    <UiBadge v-if="sensitive.includes(s.scope)" tone="warning">sensitive</UiBadge>
                  </div>
                  <p class="mt-0.5 max-w-xl text-[11.5px] leading-relaxed text-muted">{{ s.detail }}</p>
                  <p class="mt-0.5 font-mono text-[10.5px] text-line-strong">{{ s.scope }}</p>
                </td>
                <td v-for="r in roles" :key="r.role" class="border-l border-line-soft px-2 py-2.5 text-center">
                  <button type="button" :disabled="!canEdit || busy === `${r.role}:${s.scope}`"
                    class="press mx-auto flex h-6 w-6 items-center justify-center rounded-md border text-[12px] font-bold disabled:opacity-50"
                    :class="isAllowed(r.role, s.scope)
                      ? 'border-success/40 bg-success-soft text-success'
                      : 'border-line bg-white text-line-strong'"
                    :aria-label="`${isAllowed(r.role, s.scope) ? 'Remove' : 'Grant'} ${s.label} for ${r.label}`"
                    @click="toggle(r.role, s.scope)">
                    {{ isAllowed(r.role, s.scope) ? '✓' : '' }}
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p v-if="message" class="mt-2 text-[12.5px]" :class="messageTone === 'error' ? 'text-danger' : 'text-success'">{{ message }}</p>
      <p class="mt-3 max-w-3xl text-[11.5px] leading-relaxed text-muted">
        A permission says what <em>kind</em> of thing someone may do, never whose records — a staff member
        with "View timesheets" still only sees their own. Self-service (submitting your availability, requesting
        a correction) runs on the matching view permission, so you do not need to grant a write permission for it.
      </p>
    </template>

    <!-- ===== INDIVIDUAL OVERRIDES ===== -->
    <template v-if="tab === 'people'">
      <div v-if="canEdit" class="mb-4 rounded-lg border border-line bg-white p-4 shadow-warm-xs">
        <h3 class="font-display text-[16px] font-bold text-ink">Grant or revoke for one person</h3>
        <p class="mt-1 max-w-2xl text-[12px] text-muted">
          For the strong supervisor who runs a store's roster, or temporary cover while a manager is away.
          An expiry means you don't have to remember to take it back.
        </p>
        <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label class="block lg:col-span-2">
            <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Person</span>
            <select v-model="form.staff_id" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
              <option v-for="m in team" :key="m.id" :value="m.id">
                {{ m.display_name }} ({{ m.employee_code }}) · {{ roleLabel(m.role) }}
              </option>
            </select>
          </label>
          <label class="block lg:col-span-2">
            <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Permission</span>
            <select v-model="form.scope" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
              <option v-for="s in scopes" :key="s.scope" :value="s.scope">{{ s.label }}</option>
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Expires (optional)</span>
            <input v-model="form.expires_at" type="date" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
          </label>
        </div>
        <div class="mt-3 flex flex-wrap items-end gap-3">
          <label class="block flex-1 min-w-[220px]">
            <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Reason</span>
            <input v-model="form.reason" placeholder="Runs the Orchard roster"
              class="h-9 w-full rounded-md border border-line bg-white px-2.5 text-[13px]">
          </label>
          <UiButton size="sm" :loading="granting" @click="grant(true)">Grant</UiButton>
          <UiButton size="sm" variant="secondary" :loading="granting" @click="grant(false)">Revoke</UiButton>
        </div>
      </div>

      <UiTable :columns="[
        { key: 'who', label: 'Person' },
        { key: 'scope', label: 'Permission' },
        { key: 'effect', label: 'Effect', align: 'center', width: '100px' },
        { key: 'reason', label: 'Reason' },
        { key: 'expires', label: 'Expires', width: '120px' },
        { key: 'by', label: 'Granted by' },
        { key: 'action', label: '', align: 'right', width: '90px' },
      ]">
        <tr v-for="g in grants" :key="`${g.staff_id}:${g.scope}`"
          class="border-b border-line-soft last:border-0" :class="g.expired ? 'opacity-50' : ''">
          <td class="px-3.5 py-2.5">
            <p class="font-semibold text-ink">{{ g.display_name }}</p>
            <p class="text-[11.5px] text-muted">{{ g.employee_code }} · {{ roleLabel(g.role) }}</p>
          </td>
          <td class="px-3.5 py-2.5">
            <p>{{ scopeLabel(g.scope) }}</p>
            <p class="font-mono text-[10.5px] text-line-strong">{{ g.scope }}</p>
          </td>
          <td class="px-3.5 py-2.5 text-center">
            <UiBadge :tone="g.allowed ? 'success' : 'danger'">{{ g.allowed ? 'granted' : 'revoked' }}</UiBadge>
          </td>
          <td class="max-w-[200px] truncate px-3.5 py-2.5 text-muted">{{ g.reason || '—' }}</td>
          <td class="px-3.5 py-2.5 tabular-nums text-muted">
            {{ g.expires_at ? g.expires_at.slice(0, 10) : 'never' }}
            <span v-if="g.expired" class="text-[11px] text-warning">(expired)</span>
          </td>
          <td class="px-3.5 py-2.5 text-[12px] text-muted">{{ g.granted_by || '—' }}</td>
          <td class="px-3.5 py-2.5 text-right">
            <button v-if="canEdit" class="press text-[12px] font-semibold text-danger" @click="clearGrant(g)">clear</button>
          </td>
        </tr>
        <tr v-if="!grants.length">
          <td colspan="7" class="px-3.5 py-8 text-center text-[13px] text-muted">
            No individual exceptions — everyone has exactly what their role allows.
          </td>
        </tr>
      </UiTable>
    </template>

    <!-- ===== MINE ===== -->
    <template v-if="tab === 'mine'">
      <div class="max-w-3xl">
        <div class="rounded-lg border border-line-soft bg-white p-4 shadow-warm-sm">
          <p class="eyebrow">Your access</p>
          <p class="mt-0.5 font-display text-[20px] font-bold text-ink">{{ roleLabel(data?.my_role) }}</p>
          <p class="text-[12.5px] text-muted">{{ (data?.my_scopes || []).length }} permissions in effect</p>
        </div>

        <div class="mt-4 overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
          <div v-for="s in scopes" :key="s.scope"
            class="flex items-start gap-3 border-b border-line-soft px-3.5 py-2.5 last:border-0">
            <span class="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[11px] font-bold"
              :class="mine.includes(s.scope) ? 'bg-success-soft text-success' : 'bg-surface-sunken text-line-strong'">
              {{ mine.includes(s.scope) ? '✓' : '·' }}
            </span>
            <div class="min-w-0 flex-1">
              <p class="text-[13px]" :class="mine.includes(s.scope) ? 'font-semibold text-ink' : 'text-muted'">{{ s.label }}</p>
              <p class="text-[11.5px] leading-relaxed text-muted">{{ s.detail }}</p>
            </div>
          </div>
        </div>

        <div v-if="(data?.my_overrides || []).length" class="mt-4 rounded-lg border border-blue/30 bg-blue-soft p-4">
          <p class="text-[12.5px] font-semibold text-brown">Individual exceptions applied to you</p>
          <ul class="mt-1 space-y-0.5 text-[12px] text-ink-soft">
            <li v-for="o in data.my_overrides" :key="o.scope">
              {{ scopeLabel(o.scope) }} — {{ o.effect }}<span v-if="o.reason"> ({{ o.reason }})</span>
            </li>
          </ul>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Open to every signed-in staff member: "Mine" is how someone finds out which
// permission to ask for. Editing is gated by the API (staff:write) and the UI
// hides the controls accordingly.
const { data: res, refresh } = await useFetch<any>('/api/v1/permissions')

const tabs = computed(() => {
  const base = [{ key: 'mine', label: 'Mine' }]
  if (res.value?.data?.can_edit) {
    return [{ key: 'matrix', label: 'By role' }, { key: 'people', label: 'Individuals' }, ...base]
  }
  return base
})
const tab = ref(res.value?.data?.can_edit ? 'matrix' : 'mine')

const data = computed<any>(() => res.value?.data)

const roles = computed<any[]>(() => data.value?.roles || [])
const scopes = computed<any[]>(() => (data.value?.scopes || []).filter((s: any) => s.scope !== 'pos:sync'))
const sensitive = computed<string[]>(() => data.value?.sensitive || [])
const grants = computed<any[]>(() => data.value?.grants || [])
const mine = computed<string[]>(() => data.value?.my_scopes || [])
const canEdit = computed(() => !!data.value?.can_edit)

// Only the editor tabs need the roster of people.
const { data: teamRes } = await useFetch<any>('/api/v1/staff', {
  query: { limit: 100, employment_status: 'active' },
  default: () => ({ data: [] }),
  immediate: computed(() => !!res.value?.data?.can_edit) as any,
})
const team = computed<any[]>(() => teamRes.value?.data || [])

const groups = computed(() => {
  const out: Array<{ name: string; scopes: any[] }> = []
  for (const s of scopes.value) {
    let g = out.find((x) => x.name === s.group)
    if (!g) { g = { name: s.group, scopes: [] }; out.push(g) }
    g.scopes.push(s)
  }
  return out
})

const busy = ref('')
const message = ref('')
const messageTone = ref<'ok' | 'error'>('ok')

function isAllowed(role: string, scope: string) {
  return (data.value?.matrix?.[role] || []).includes(scope)
}

async function toggle(role: string, scope: string) {
  const next = !isAllowed(role, scope)
  busy.value = `${role}:${scope}`
  message.value = ''
  try {
    const r: any = await $fetch('/api/v1/permissions/matrix', {
      method: 'POST', body: { role, scope, allowed: next },
    })
    messageTone.value = 'ok'
    message.value = r.note
    await refresh()
  } catch (err: any) {
    messageTone.value = 'error'
    message.value = err?.data?.message || err?.data?.statusMessage || 'Could not change that permission'
  } finally { busy.value = '' }
}

const form = reactive({ staff_id: '', scope: 'roster:publish', expires_at: '', reason: '' })
watch(team, () => { if (!form.staff_id && team.value.length) form.staff_id = team.value[0].id }, { immediate: true })

const granting = ref(false)

async function grant(allowed: boolean) {
  granting.value = true
  message.value = ''
  try {
    const r: any = await $fetch('/api/v1/permissions/grants', {
      method: 'POST',
      body: {
        staff_id: form.staff_id, scope: form.scope, allowed,
        expires_at: form.expires_at || undefined, reason: form.reason || undefined,
      },
    })
    messageTone.value = 'ok'
    message.value = r.note
    await refresh()
  } catch (err: any) {
    messageTone.value = 'error'
    message.value = err?.data?.message || err?.data?.statusMessage || 'Failed'
  } finally { granting.value = false }
}

async function clearGrant(g: any) {
  try {
    await $fetch('/api/v1/permissions/grants', {
      method: 'POST', body: { staff_id: g.staff_id, scope: g.scope, remove: true },
    })
    await refresh()
  } catch (err: any) {
    messageTone.value = 'error'
    message.value = err?.data?.message || err?.data?.statusMessage || 'Failed'
  }
}

function scopeLabel(scope: string) {
  return (data.value?.scopes || []).find((s: any) => s.scope === scope)?.label || scope
}
function roleLabel(role?: string) {
  return roles.value.find((r) => r.role === role)?.label || role || '—'
}
</script>
