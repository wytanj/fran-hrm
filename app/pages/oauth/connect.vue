<template>
  <div>
    <div class="mb-6 text-center">
      <p class="eyebrow">Connect</p>
      <h1 class="h1-display text-[30px]">Use FranHRM in Claude</h1>
      <p class="mt-1 text-[13px] text-muted">
        Ask Claude about rosters, hours and leave — with your own permissions.
      </p>
    </div>

    <UiCard v-if="!staff" tone="surface">
      <p class="text-[14px] font-semibold">Sign in first</p>
      <p class="mt-1 text-[13px] text-muted">
        Claude connects as <em>you</em>, so we need to know who you are.
      </p>
      <NuxtLink :to="`/login?redirect=${encodeURIComponent(route.fullPath)}`" class="mt-4 block">
        <UiButton class="w-full">Sign in to FranHRM</UiButton>
      </NuxtLink>
    </UiCard>

    <template v-else>
      <UiCard tone="surface">
        <p class="text-[13px]">
          Signed in as <strong>{{ staff.display_name }}</strong>
          <span class="text-muted">({{ staff.employee_code }})</span>
        </p>
        <p class="mt-1 text-[12px] text-muted">
          Claude will get {{ toolCount ?? '…' }} tools, scoped to your role
          ({{ roleLabel(staff.role) }}).
        </p>
      </UiCard>

      <UiSectionTitle eyebrow="Step by step" title="Add the connector" />
      <div class="overflow-hidden rounded-xl border border-line-soft bg-white shadow-warm-sm">
        <div v-for="(step, i) in steps" :key="i" class="flex gap-3 px-4 py-3.5" :class="i > 0 ? 'border-t border-line-soft' : ''">
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-yellow-soft text-[12px] font-bold text-brown">
            {{ i + 1 }}
          </span>
          <div class="min-w-0 flex-1">
            <p class="text-[14px] font-semibold text-ink" v-html="step.title" />
            <p v-if="step.body" class="mt-0.5 text-[12px] leading-relaxed text-muted" v-html="step.body" />
            <div v-if="step.copy" class="mt-2 flex items-center gap-2">
              <code class="min-w-0 flex-1 truncate rounded-md bg-surface-sunken px-2.5 py-1.5 font-mono text-[11px] text-ink">{{ step.copy }}</code>
              <button class="press shrink-0 rounded-full bg-yellow-soft px-3 py-1.5 text-[11px] font-semibold text-brown"
                @click="copy(step.copy!)">
                {{ copied === step.copy ? 'Copied ✓' : 'Copy' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <UiCard tone="blue" class="mt-4">
        <p class="text-[13px] font-semibold text-brown">What happens when you click Connect</p>
        <p class="mt-1 text-[12px] leading-relaxed text-ink-soft">
          Claude sends you back here to sign in and approve. You'll see exactly which
          account and how many tools before anything is granted. Your permissions are
          re-checked on every request, so a role change takes effect immediately.
        </p>
      </UiCard>

      <p v-if="needsAdmin" class="mt-4 rounded-lg bg-warning-soft px-4 py-3 text-[12px] text-warning">
        This deployment has no connector credentials yet — an HQ admin must generate them
        in Manage → Connect Claude before anyone can connect.
      </p>

      <NuxtLink to="/" class="mt-5 block">
        <UiButton variant="ghost" size="sm" class="w-full">Back to FranHRM</UiButton>
      </NuxtLink>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * Invite landing page. The OAuth flow itself is always started by Claude —
 * this page exists to get the right person signed in first and to hand them
 * the connector URL, so "invite link + signed in" is all they need to do.
 */
definePageMeta({ layout: 'auth', middleware: [] })

const route = useRoute()
const { staff, refresh, ready } = useSession()
if (!ready.value) await refresh()

const info = ref<any>(null)
const needsAdmin = ref(false)
const copied = ref('')

// Public discovery tells us the connector URL and whether OAuth is live here.
const { data: discovery } = await useFetch<any>('/mcp', { server: false })
watch(discovery, () => {
  needsAdmin.value = discovery.value ? !discovery.value.oauth : false
}, { immediate: true })

const connectorUrl = computed(() => `${useRequestURL().origin}/mcp`)
const toolCount = computed(() => info.value?.tool_count ?? null)

// Best effort: shows the staff member their own tool count up front.
onMounted(async () => {
  if (!staff.value) return
  try {
    info.value = await $fetch('/api/v1/mcp-connector/my-access')
  } catch { /* count is a nicety, not the point of the page */ }
})

const steps = computed(() => [
  {
    title: 'Open Claude → Settings → Connectors',
    body: 'On claude.ai, or in the Claude desktop app.',
  },
  {
    title: 'Add a custom connector with this URL',
    body: 'If your organisation already added FranHRM, skip to the next step.',
    copy: connectorUrl.value,
  },
  {
    title: 'Paste the OAuth Client ID and Secret',
    body: 'Under <strong>Advanced settings</strong>. Ask an HQ admin for these — they are the same for everyone in the company.',
  },
  {
    title: 'Click <strong>Connect</strong>',
    body: 'You will be sent here to sign in and approve. That is the step that ties Claude to your account.',
  },
])

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = text
    setTimeout(() => (copied.value = ''), 1500)
  } catch { /* clipboard blocked — the text is visible and selectable anyway */ }
}

function roleLabel(role?: string) {
  return ({
    staff: 'Staff', supervisor: 'Supervisor', store_manager: 'Store Manager',
    area_manager: 'Area Manager', hq_admin: 'HQ Admin',
  } as Record<string, string>)[role || ''] || role || '—'
}
</script>
