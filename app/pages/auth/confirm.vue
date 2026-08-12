<template>
  <div class="mx-auto max-w-sm">
    <div class="mb-6 text-center">
      <p class="eyebrow">Fran team</p>
      <h1 class="h1-display text-[30px]">Signing you in</h1>
    </div>

    <UiCard tone="surface">
      <div v-if="state === 'loading'" class="flex items-center justify-center gap-2 py-6 text-[13px] text-muted">
        <UiSpinner size="sm" /> Finishing Google sign-in…
      </div>

      <div v-else-if="state === 'create'">
        <p class="text-[14px] font-semibold text-ink">Create your organization</p>
        <p class="mt-1 text-[12.5px] text-muted">You're signing in as <strong>{{ email }}</strong>. Name your workspace to get started — you'll be its admin.</p>
        <UiInput v-model="orgName" label="Organization name" placeholder="e.g. Fran" class="mt-3" />
        <UiButton class="mt-3 w-full" :loading="busy" :disabled="!orgName.trim()" @click="createOrg">Create workspace</UiButton>
      </div>

      <div v-else-if="state === 'ask_owner'" class="py-2 text-center">
        <p class="text-[14px] font-semibold text-ink">You're not a member yet</p>
        <p class="mt-1 text-[12.5px] text-muted">
          <strong>{{ email }}</strong> isn't part of a Fran workspace and can't create one. Ask an owner to invite this email, then sign in again.
        </p>
        <NuxtLink to="/login" class="press mt-3 inline-block text-[12.5px] font-semibold text-brown">Back to sign in</NuxtLink>
      </div>

      <div v-else class="py-2 text-center">
        <p class="text-[13px] text-danger">{{ error || 'Something went wrong.' }}</p>
        <NuxtLink to="/login" class="press mt-3 inline-block text-[12.5px] font-semibold text-brown">Back to sign in</NuxtLink>
      </div>
    </UiCard>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const { refresh } = useSession()
const state = ref<'loading' | 'create' | 'ask_owner' | 'error'>('loading')
const email = ref('')
const orgName = ref('')
const error = ref('')
const busy = ref(false)
let accessToken = ''

async function tokenFromSession(sb: any): Promise<string | null> {
  const immediate = (await sb.auth.getSession()).data.session
  if (immediate) return immediate.access_token
  // PKCE code exchange may still be in flight — wait for the sign-in event.
  return await new Promise((resolve) => {
    const { data: sub } = sb.auth.onAuthStateChange((_e: string, session: any) => {
      if (session) { sub.subscription.unsubscribe(); resolve(session.access_token) }
    })
    setTimeout(() => { try { sub.subscription.unsubscribe() } catch { /* noop */ } resolve(null) }, 8000)
  })
}

onMounted(async () => {
  try {
    const sb = useSupabaseBrowser()
    const token = await tokenFromSession(sb)
    if (!token) { state.value = 'error'; error.value = 'Google sign-in did not complete. Try again.'; return }
    accessToken = token
    const res: any = await $fetch('/api/auth/sso-confirm', { method: 'POST', body: { access_token: token } })
    if (res.status === 'entered') { await refresh(); await navigateTo('/') }
    else if (res.status === 'create') { email.value = res.email; state.value = 'create' }
    else { email.value = res.email; state.value = 'ask_owner' }
  } catch (err: any) {
    state.value = 'error'
    error.value = err?.data?.message || err?.data?.statusMessage || 'Sign-in failed.'
  }
})

async function createOrg() {
  busy.value = true; error.value = ''
  try {
    const res: any = await $fetch('/api/auth/create-workspace', {
      method: 'POST', body: { access_token: accessToken, org_name: orgName.value.trim() },
    })
    if (res.status === 'entered') { await refresh(); await navigateTo('/') }
  } catch (err: any) {
    error.value = err?.data?.message || err?.data?.statusMessage || 'Could not create the workspace.'
  } finally { busy.value = false }
}
</script>
