<template>
  <div>
    <div class="mb-8 text-center">
      <p class="eyebrow">Fran team</p>
      <h1 class="h1-display text-[36px]">FranHRM</h1>
      <p class="mt-1 text-[13px] text-muted">Rosters, clocking and leave for HQ & stores</p>
    </div>

    <UiCard v-if="connectingClaude" tone="blue" class="mb-3 !p-3">
      <p class="text-[13px] font-semibold text-brown">Connecting Claude</p>
      <p class="mt-0.5 text-[12px] text-ink-soft">
        Sign in so Claude gets tools scoped to your own role.
      </p>
    </UiCard>

    <UiCard tone="surface">
      <form class="space-y-4" @submit.prevent="submit">
        <UiInput v-model="identifier" label="Employee code or email" placeholder="e.g. SM001" />
        <UiInput v-model="pin" label="PIN" type="password" inputmode="numeric" :maxlength="12" placeholder="••••••" :error="error" />
        <UiButton type="submit" :loading="loading" class="w-full">Sign in</UiButton>
      </form>
    </UiCard>

    <p class="mt-4 text-center text-[12px] text-muted">
      Locked out? Ask your store manager to reset your PIN.
    </p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { login } = useSession()
const route = useRoute()
const identifier = ref('')
const pin = ref('')
const error = ref('')
const loading = ref(false)

// Only same-origin paths, so ?redirect= can't be used as an open redirect.
const redirectTo = computed(() => {
  const raw = typeof route.query.redirect === 'string' ? route.query.redirect : ''
  return raw.startsWith('/') && !raw.startsWith('//') ? raw : '/'
})

const connectingClaude = computed(() => redirectTo.value.startsWith('/oauth/authorize'))

async function submit() {
  error.value = ''
  loading.value = true
  try {
    await login(identifier.value, pin.value)
    await navigateTo(redirectTo.value)
  } catch (err: any) {
    error.value = err?.data?.message || err?.data?.statusMessage || err?.statusMessage || 'Sign in failed'
  } finally {
    loading.value = false
  }
}
</script>
