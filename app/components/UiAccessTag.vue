<template>
  <span v-if="entry"
    class="ml-1.5 inline-flex items-center rounded-full px-1.5 py-[1px] align-middle text-[9.5px] font-bold uppercase tracking-wide"
    :class="entry.cls" :title="entry.title">{{ entry.label }}</span>
</template>

<script setup lang="ts">
// How a real staff member gets in — shown beside their name. SSO = established
// workspace member; OTP = invited (phone OTP, pending); PIN = code + PIN.
const props = defineProps<{ method?: string }>()

const MAP: Record<string, { label: string; cls: string; title: string }> = {
  sso: { label: 'SSO', cls: 'bg-success-soft text-success', title: 'Workspace member — signs in with Google SSO' },
  otp: { label: 'OTP', cls: 'bg-blue-soft text-brown', title: 'Invited — phone one-time-password access (Twilio)' },
  pin: { label: 'PIN', cls: 'bg-surface-sunken text-muted', title: 'Signs in with employee code + PIN' },
}
const entry = computed(() => MAP[props.method || 'pin'])
</script>
