<template>
  <div class="mx-auto max-w-sm">
    <div class="mb-6 text-center">
      <p class="eyebrow">Fran team</p>
      <h1 class="h1-display text-[28px]">You're invited</h1>
    </div>

    <UiCard tone="surface">
      <template v-if="invite?.valid">
        <p class="text-[13.5px] text-ink">Join <strong>{{ invite.workspace || 'the workspace' }}</strong> as <strong>{{ roleLabel(invite.role) }}</strong>.</p>
        <p class="mt-1 text-[12.5px] text-muted">Accept by signing in with Google using <strong>{{ invite.email }}</strong>.</p>
        <UiButton class="mt-3 w-full" :loading="loading" @click="google">Continue with Google</UiButton>
        <p v-if="error" class="mt-2 text-[12.5px] text-danger">{{ error }}</p>
      </template>
      <template v-else-if="invite?.accepted">
        <p class="text-[13px] text-ink">This invite has already been accepted.</p>
        <NuxtLink to="/login" class="press mt-2 inline-block text-[12.5px] font-semibold text-brown">Sign in →</NuxtLink>
      </template>
      <template v-else>
        <p class="text-[13px] text-danger">This invite link is invalid or has expired. Ask an owner to send a new one.</p>
        <NuxtLink to="/login" class="press mt-2 inline-block text-[12.5px] font-semibold text-brown">Back to sign in</NuxtLink>
      </template>
    </UiCard>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const { data } = await useFetch<any>(`/api/invite/${route.params.token}`, { lazy: true })
const invite = computed<any>(() => data.value?.data)

const loading = ref(false)
const error = ref('')
async function google() {
  loading.value = true; error.value = ''
  try {
    const sb = useSupabaseBrowser()
    const { error: e } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: `${window.location.origin}/auth/confirm` } })
    if (e) throw e
  } catch (err: any) { error.value = err?.message || 'Google sign-in failed'; loading.value = false }
}
function roleLabel(r: string) {
  return ({ staff: 'Staff', supervisor: 'Supervisor', store_manager: 'Store Manager', area_manager: 'Area Manager', finance: 'Finance', hq_admin: 'HQ Admin' } as Record<string, string>)[r] || r
}
</script>
