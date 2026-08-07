<template>
  <div>
    <div class="mb-6 text-center">
      <p class="eyebrow">Connect</p>
      <h1 class="h1-display text-[30px]">Connect Claude to FranHRM</h1>
      <p class="mt-1 text-[13px] text-muted">Claude will act with your permissions — nothing more.</p>
    </div>

    <UiCard v-if="loading" tone="surface">
      <p class="text-[14px] text-muted">Checking your account…</p>
    </UiCard>

    <UiCard v-else-if="error" tone="surface">
      <p class="text-[14px] font-semibold text-danger">Can't complete this request</p>
      <p class="mt-1 text-[13px] text-ink-soft">{{ error }}</p>
      <NuxtLink to="/" class="mt-4 block"><UiButton variant="secondary" class="w-full">Back to FranHRM</UiButton></NuxtLink>
    </UiCard>

    <template v-else-if="info">
      <UiCard tone="surface">
        <dl class="space-y-2.5 text-[13px]">
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted">Signing in as</dt>
            <dd class="text-right font-semibold text-ink">
              {{ info.staff?.display_name }}
              <span class="font-normal text-muted">({{ info.staff?.employee_code }})</span>
            </dd>
          </div>
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted">Your role</dt>
            <dd class="text-right text-ink">{{ roleLabel(info.staff?.role) }}</dd>
          </div>
          <div v-if="info.staff?.store" class="flex items-baseline justify-between gap-4">
            <dt class="text-muted">Store</dt>
            <dd class="text-right text-ink">{{ info.staff.store }}</dd>
          </div>
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted">Tools Claude will get</dt>
            <dd class="text-right text-ink">
              {{ info.tool_count }}
              <button v-if="info.tool_names?.length" type="button"
                class="ml-1.5 text-[12px] font-semibold text-brown underline decoration-brown/30"
                @click="showTools = !showTools">
                {{ showTools ? 'hide' : 'show' }}
              </button>
            </dd>
          </div>
        </dl>

        <p v-if="showTools" class="mt-3 max-h-40 overflow-y-auto rounded-md bg-surface-sunken p-3 font-mono text-[11px] leading-relaxed text-ink-soft">
          {{ info.tool_names?.join(', ') }}
        </p>

        <UiCard v-if="info.privileged_tools?.length" tone="peach" class="mt-3 !p-3">
          <p class="text-[12px] font-semibold text-brown">Your role includes write access</p>
          <p class="mt-0.5 text-[12px] text-ink-soft">
            Claude will be able to {{ privilegedSummary }}. It always asks you first.
          </p>
        </UiCard>

        <UiCard v-if="info.invite?.note" tone="blue" class="mt-3 !p-3">
          <p class="text-[12px] text-ink-soft">{{ info.invite.note }}</p>
        </UiCard>

        <UiCard v-if="!info.can_authorize" tone="peach" class="mt-3 !p-3">
          <p class="text-[12px] font-semibold text-brown">{{ info.reason }}</p>
        </UiCard>

        <div class="mt-5 space-y-3">
          <UiButton class="w-full" :disabled="!info.can_authorize" :loading="approving" @click="approve">
            Authorize Claude
          </UiButton>
          <UiButton variant="ghost" size="sm" class="w-full" @click="switchAccount">
            Use a different account
          </UiButton>
        </div>
      </UiCard>

      <p class="mt-5 text-center text-[11px] leading-relaxed text-muted">
        Your permissions are re-checked on every request, so a role change in FranHRM
        takes effect immediately. An HQ admin can revoke access any time.
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * Consent screen for the Claude MCP connector.
 *
 * Its job is not legal consent — Claude shows its own Connect card. It exists
 * so the staff member sees WHICH account they are binding and how much power
 * it carries, before Claude gets a token.
 */
definePageMeta({ layout: 'auth', middleware: [] })

const route = useRoute()
const { logout } = useSession()

const info = ref<any>(null)
const loading = ref(true)
const approving = ref(false)
const error = ref('')
const showTools = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data: any = await $fetch('/api/oauth/authorize-info', { query: route.query })
    if (!data.signed_in) {
      // Come back to this exact request, query intact, after signing in.
      await navigateTo(`/login?redirect=${encodeURIComponent(route.fullPath)}`)
      return
    }
    info.value = data
  } catch (err: any) {
    error.value = err?.data?.message || err?.data?.statusMessage || err?.statusMessage || 'Could not read the request.'
  } finally {
    loading.value = false
  }
}

async function approve() {
  approving.value = true
  error.value = ''
  try {
    const res: any = await $fetch('/api/oauth/approve', { method: 'POST', body: { ...route.query } })
    // Full page navigation: the target is claude.ai, not an app route.
    window.location.href = res.redirect_url
  } catch (err: any) {
    error.value = err?.data?.message || err?.data?.statusMessage || 'Could not authorize.'
    approving.value = false
  }
}

async function switchAccount() {
  await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
  await navigateTo(`/login?redirect=${encodeURIComponent(route.fullPath)}`)
}

const privilegedSummary = computed(() => {
  const tools: string[] = info.value?.privileged_tools || []
  const parts: string[] = []
  if (tools.includes('roster_publish')) parts.push('publish rosters')
  if (tools.includes('shift_assign')) parts.push('assign shifts')
  return parts.length ? parts.join(' and ') : 'make changes'
})

function roleLabel(role?: string) {
  return ({
    staff: 'Staff', supervisor: 'Supervisor', store_manager: 'Store Manager',
    area_manager: 'Area Manager', hq_admin: 'HQ Admin',
  } as Record<string, string>)[role || ''] || role || '—'
}

onMounted(load)
</script>
