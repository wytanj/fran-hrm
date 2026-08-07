<template>
  <div class="max-w-3xl">
    <UiPageHeader eyebrow="Account" title="My account" />

    <div class="rounded-lg border border-line-soft bg-white p-5 shadow-warm-sm">
      <div class="flex items-center gap-4">
        <div class="flex h-14 w-14 items-center justify-center rounded-full bg-yellow-soft text-[18px] font-bold text-brown">
          {{ initials }}
        </div>
        <div class="min-w-0 flex-1">
          <p class="font-display text-[20px] font-bold text-ink">{{ staff?.display_name }}</p>
          <p class="text-[12.5px] text-muted">
            {{ staff?.employee_code }} · {{ roleLabel }}<span v-if="staff?.home_store"> · {{ staff.home_store.name }}</span>
          </p>
          <p v-if="staff?.email" class="text-[12.5px] text-muted">{{ staff.email }}</p>
        </div>
        <UiButton variant="secondary" size="sm" @click="logout">Sign out</UiButton>
      </div>
    </div>

    <div class="mt-5 grid gap-4 sm:grid-cols-2">
      <div class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-xs">
        <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Shortcuts</p>
        <NuxtLink v-for="(l, i) in links" :key="l.to" :to="l.to"
          class="press flex items-center gap-3 px-3.5 py-2.5" :class="i > 0 ? 'border-t border-line-soft' : ''">
          <span class="w-4 text-center text-[13px] text-muted">{{ l.icon }}</span>
          <span class="flex-1 text-[13px] font-semibold text-ink">{{ l.label }}</span>
          <span class="text-line-strong">›</span>
        </NuxtLink>
      </div>

      <div class="rounded-lg border border-line-soft bg-white p-4 shadow-warm-xs">
        <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Claude connection</p>
        <template v-if="access">
          <p class="mt-1.5 text-[13px] text-ink">
            <template v-if="access.connected">Connected — {{ access.tool_count }} tools available.</template>
            <template v-else>Not connected. {{ access.tool_count }} tools would be available to you.</template>
          </p>
          <p class="mt-1 text-[11.5px] text-muted">
            Scoped to your role ({{ roleLabel }}); re-checked on every request.
          </p>
          <NuxtLink to="/oauth/connect" class="press mt-2 inline-block text-[12.5px] font-semibold text-brown underline decoration-brown/30">
            {{ access.connected ? 'Connection details' : 'Connect Claude' }} →
          </NuxtLink>
        </template>
        <p v-else class="mt-1.5 text-[13px] text-muted">Checking…</p>
      </div>
    </div>

    <div class="mt-5 rounded-lg border border-line-soft bg-surface-sunken p-4">
      <p class="text-[12.5px] font-semibold text-ink">Changing your PIN</p>
      <p class="mt-1 text-[12px] leading-relaxed text-muted">
        PINs are stored hashed and cannot be read back, so a forgotten PIN is replaced rather than
        recovered. Ask an area manager or HQ admin to set a new one — see
        <NuxtLink to="/help/signing-in" class="font-semibold text-brown underline decoration-brown/30">signing in and PINs</NuxtLink>.
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
const { staff, logout } = useSession()

const { data: access } = await useFetch<any>('/api/v1/mcp-connector/my-access', { server: false })

const initials = computed(() =>
  staff.value?.display_name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase())

const roleLabel = computed(() => ({
  staff: 'Staff', supervisor: 'Supervisor', store_manager: 'Store Manager',
  area_manager: 'Area Manager', hq_admin: 'HQ Admin',
}[staff.value?.role || ''] || staff.value?.role))

const links = [
  { to: '/availability', label: 'My availability', icon: '◐' },
  { to: '/swaps', label: 'Shift swaps', icon: '⇄' },
  { to: '/leave', label: 'Leave & balances', icon: '⌂' },
  { to: '/clock', label: 'Clock & corrections', icon: '◷' },
  { to: '/permissions', label: 'What I can access', icon: '⛿' },
  { to: '/help', label: 'Help centre', icon: '?' },
]
</script>
