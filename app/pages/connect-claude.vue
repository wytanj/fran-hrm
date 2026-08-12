<template>
  <div>
    <p class="eyebrow">Admin</p>
    <h1 class="h1-display">Connect Claude</h1>
    <p class="mt-1 text-[13px] text-muted">
      Staff connect Claude by signing in here — each person gets tools scoped to their own role.
    </p>

    <!-- Connector URL -->
    <UiSectionTitle eyebrow="Step 1" title="Connector URL" subtitle="Paste this into Claude → Settings → Connectors → Add custom connector." />
    <UiCard tone="surface">
      <div class="flex items-center gap-2">
        <code class="min-w-0 flex-1 truncate rounded-md bg-surface-sunken px-3 py-2 font-mono text-[12px]">{{ data?.connector_url }}</code>
        <button class="press shrink-0 rounded-full bg-yellow-soft px-3 py-2 text-[11px] font-semibold text-brown" @click="copy(data?.connector_url)">
          {{ copied === data?.connector_url ? 'Copied ✓' : 'Copy' }}
        </button>
      </div>
    </UiCard>

    <!-- Credentials -->
    <UiSectionTitle eyebrow="Step 2" title="OAuth credentials" subtitle="Goes in Claude's Advanced settings. Same pair for the whole company." />
    <UiCard tone="surface">
      <template v-if="data?.client?.configured">
        <dl class="space-y-2 text-[13px]">
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted">Client ID</dt>
            <dd class="min-w-0 truncate text-right font-mono text-[12px]">{{ data.client.client_id }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted">Secret</dt>
            <dd class="text-right font-mono text-[12px]">
              {{ data.client.has_secret ? `${data.client.secret_prefix}…` : 'none (public client)' }}
            </dd>
          </div>
          <div class="flex items-baseline justify-between gap-3">
            <dt class="text-muted">Source</dt>
            <dd class="text-right">{{ data.client.source === 'env' ? 'Environment variables' : 'FranHRM database' }}</dd>
          </div>
          <div v-if="data.client.last_used_at" class="flex items-baseline justify-between gap-3">
            <dt class="text-muted">Last used</dt>
            <dd class="text-right">{{ fmtDate(data.client.last_used_at) }}</dd>
          </div>
        </dl>
        <div class="mt-3 flex items-center gap-2">
          <button class="press rounded-full bg-surface-sunken px-3 py-1.5 text-[11px] font-semibold text-brown" @click="copy(data.client.client_id)">
            Copy client ID
          </button>
          <UiButton v-if="isHqAdmin" size="sm" variant="secondary" :loading="busy" @click="generate">Rotate secret</UiButton>
        </div>
        <p v-if="isHqAdmin" class="mt-2 text-[11px] text-muted">
          Rotating keeps the same client ID — update only the secret field in Claude. Live
          sessions keep working for up to an hour; refreshes fail until Claude has the new secret.
        </p>
      </template>
      <template v-else>
        <p class="text-[14px] font-semibold">No credentials yet</p>
        <p class="mt-1 text-[13px] text-muted">
          Generate a client ID and secret, then paste both into Claude. The secret is shown once.
        </p>
        <UiButton v-if="isHqAdmin" size="sm" class="mt-3" :loading="busy" @click="generate">Generate credentials</UiButton>
        <p v-else class="mt-3 text-[12px] text-warning">Only an HQ admin can generate these.</p>
      </template>

      <UiCard v-if="fresh" tone="yellow" class="mt-4">
        <p class="text-[12px] font-semibold text-brown">
          {{ fresh.rotated ? 'New secret — save it now' : 'Credentials created — save the secret now' }}
        </p>
        <div class="mt-2 space-y-2">
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-wide text-brown-muted">Client ID</p>
            <code class="block break-all font-mono text-[12px] text-ink">{{ fresh.client_id }}</code>
          </div>
          <div>
            <p class="text-[10px] font-semibold uppercase tracking-wide text-brown-muted">Client secret</p>
            <code class="block break-all font-mono text-[12px] text-ink">{{ fresh.client_secret }}</code>
          </div>
        </div>
        <p class="mt-2 text-[11px] text-ink-soft">This secret is not stored in readable form and won't be shown again.</p>
      </UiCard>
    </UiCard>

    <!-- Invite links -->
    <UiSectionTitle eyebrow="Step 3" title="Invite staff" subtitle="Send a link. They sign in, then click Connect in Claude." />
    <UiCard tone="surface">
      <div class="flex flex-wrap items-end gap-3">
        <label class="block min-w-[180px] flex-1">
          <span class="mb-1 block text-[11px] font-semibold text-ink-soft">For (optional)</span>
          <select v-model="inviteStaffId" class="h-10 w-full rounded-md border border-line bg-white px-2 text-[13px]">
            <option value="">Anyone with the link</option>
            <option v-for="m in team" :key="m.id" :value="m.id">{{ m.display_name }} ({{ m.employee_code }})</option>
          </select>
        </label>
        <UiButton size="sm" :loading="inviting" @click="createInvite">Create link</UiButton>
      </div>
      <div v-if="freshInvite" class="mt-3 flex items-center gap-2">
        <code class="min-w-0 flex-1 truncate rounded-md bg-surface-sunken px-2.5 py-1.5 font-mono text-[11px]">{{ freshInvite.url }}</code>
        <button class="press shrink-0 rounded-full bg-yellow-soft px-3 py-1.5 text-[11px] font-semibold text-brown" @click="copy(freshInvite.url)">
          {{ copied === freshInvite.url ? 'Copied ✓' : 'Copy' }}
        </button>
      </div>

      <div v-if="data?.invites?.length" class="mt-4 space-y-1.5">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-muted">Recent links</p>
        <div v-for="inv in data.invites" :key="inv.url" class="flex items-center gap-2 text-[12px]">
          <UiBadge :tone="inv.used_at ? 'success' : new Date(inv.expires_at) < new Date() ? 'muted' : 'warning'">
            {{ inv.used_at ? 'used' : new Date(inv.expires_at) < new Date() ? 'expired' : 'open' }}
          </UiBadge>
          <span class="flex-1 truncate text-muted">{{ inv.staff }}</span>
          <button class="press text-[11px] font-semibold text-brown" @click="copy(inv.url)">copy</button>
        </div>
      </div>
    </UiCard>

    <!-- Live connections -->
    <UiSectionTitle eyebrow="Live" title="Connected staff" />
    <div class="overflow-hidden rounded-xl border border-line-soft bg-white shadow-warm-sm">
      <template v-if="data?.connections?.length">
        <div v-for="(c, i) in data.connections" :key="c.staff_id"
          class="flex items-center gap-3 px-4 py-3" :class="i > 0 ? 'border-t border-line-soft' : ''">
          <div class="flex-1">
            <p class="text-[14px] font-semibold">{{ c.display_name }} <span class="text-[11px] font-normal text-muted">{{ c.employee_code }}</span></p>
            <p class="text-[12px] text-muted">
              {{ roleLabel(c.role) }} · connected {{ fmtDate(c.created_at) }}
              <span v-if="c.last_used_at"> · last used {{ fmtDate(c.last_used_at) }}</span>
            </p>
          </div>
          <UiButton v-if="isAreaManager" size="sm" variant="secondary" @click="disconnect(c)">Disconnect</UiButton>
        </div>
      </template>
      <UiEmpty v-else title="Nobody connected yet" subtitle="Send an invite link to get started." icon="🔌" />
    </div>

    <!-- Role matrix -->
    <UiSectionTitle eyebrow="Reference" title="What each role gets" />
    <div class="overflow-hidden rounded-xl border border-line-soft bg-white shadow-warm-sm">
      <div v-for="(r, i) in data?.role_matrix || []" :key="r.role"
        class="flex items-center gap-3 px-4 py-2.5" :class="i > 0 ? 'border-t border-line-soft' : ''">
        <span class="w-32 text-[13px] font-semibold">{{ roleLabel(r.role) }}</span>
        <span class="text-[13px] text-muted">{{ r.tool_count }} tools</span>
        <span class="ml-auto text-[11px] text-muted">{{ writeLabel(r.scopes) }}</span>
      </div>
    </div>

    <p v-if="error" class="mt-3 text-[13px] text-danger">{{ error }}</p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['supervisor-only'] })

const { isAreaManager, staff } = useSession()
const isHqAdmin = computed(() => staff.value?.role === 'hq_admin')

const { data: res, refresh } = await useFetch<any>('/api/v1/mcp-connector', { lazy: true })
const data = computed<any>(() => res.value?.data)

const { data: teamRes } = await useFetch<any>('/api/v1/staff', { query: { limit: 100, employment_status: 'active' }, lazy: true })
const team = computed<any[]>(() => teamRes.value?.data || [])

const busy = ref(false)
const inviting = ref(false)
const error = ref('')
const copied = ref('')
const fresh = ref<any>(null)
const freshInvite = ref<any>(null)
const inviteStaffId = ref('')

async function generate() {
  busy.value = true; error.value = ''
  try {
    const r: any = await $fetch('/api/v1/mcp-connector/client', { method: 'POST' })
    fresh.value = r.data
    await refresh()
  } catch (err: any) { error.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { busy.value = false }
}

async function createInvite() {
  inviting.value = true; error.value = ''
  try {
    const r: any = await $fetch('/api/v1/mcp-connector/invites', {
      method: 'POST',
      body: { staff_id: inviteStaffId.value || null },
    })
    freshInvite.value = r.data
    await refresh()
  } catch (err: any) { error.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { inviting.value = false }
}

async function disconnect(c: any) {
  try {
    await $fetch('/api/v1/mcp-connector/disconnect', { method: 'POST', body: { staff_id: c.staff_id } })
    await refresh()
  } catch (err: any) { error.value = err?.data?.message || err?.data?.statusMessage || 'Failed' }
}

async function copy(text?: string) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    setTimeout(() => (copied.value = ''), 1500)
  } catch { /* clipboard blocked — the text is selectable anyway */ }
}

function writeLabel(scopes: string[]) {
  if (scopes.includes('roster:publish')) return 'can publish rosters, approve leave'
  if (scopes.includes('attendance:write')) return 'can edit attendance, draft rosters'
  if (scopes.includes('leave:write')) return 'read-only + own leave requests'
  return 'no access'
}
function roleLabel(role?: string) {
  return ({
    staff: 'Staff', supervisor: 'Supervisor', store_manager: 'Store Manager',
    area_manager: 'Area Manager', hq_admin: 'HQ Admin',
  } as Record<string, string>)[role || ''] || role || '—'
}
function fmtDate(iso?: string) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })
}
</script>
