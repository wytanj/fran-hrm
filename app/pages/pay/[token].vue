<template>
  <div class="mx-auto max-w-lg px-4 py-8">
    <div class="mb-6 text-center">
      <p class="eyebrow">Fran pay</p>
      <h1 class="h1-display text-[28px]">{{ snap?.staff?.display_name || 'My pay' }}</h1>
      <p class="mt-1 text-[12.5px] text-muted">
        {{ snap?.staff?.employee_code }} · {{ employmentLabel }}
      </p>
    </div>

    <UiCard v-if="error" tone="surface" class="mb-4">
      <p class="text-[13px] font-semibold text-danger">{{ error }}</p>
      <p class="mt-1 text-[12.5px] text-muted">Ask HQ for a fresh pay-portal link.</p>
    </UiCard>

    <template v-else-if="snap">
      <!-- Live estimate — only while active + payroll-eligible -->
      <UiCard v-if="showLiveEstimate" tone="surface" class="mb-4">
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-[11px] font-semibold uppercase tracking-wide text-muted">Live estimate</p>
            <p class="mt-0.5 text-[12.5px] text-ink-soft">{{ basisLabel }}</p>
          </div>
          <UiBadge tone="warning">Estimate</UiBadge>
        </div>
        <p class="mt-3 font-display text-[32px] font-bold tabular-nums text-ink">
          {{ money(estimate?.wages?.gross_cents) }}
        </p>
        <dl class="mt-3 grid grid-cols-2 gap-2 text-[12.5px]">
          <div>
            <dt class="text-muted">Ordinary wages</dt>
            <dd class="font-semibold tabular-nums">{{ money(estimate?.wages?.ordinary_wages_cents) }}</dd>
          </div>
          <div>
            <dt class="text-muted">Additional (OT/AW)</dt>
            <dd class="font-semibold tabular-nums">{{ money(estimate?.wages?.additional_wages_cents) }}</dd>
          </div>
          <div>
            <dt class="text-muted">Hours</dt>
            <dd class="font-semibold tabular-nums">{{ estimate?.hours?.total_hours ?? 0 }}h</dd>
          </div>
          <div>
            <dt class="text-muted">Weekly OT</dt>
            <dd class="font-semibold tabular-nums">{{ estimate?.hours?.weekly_ot_hours ?? 0 }}h</dd>
          </div>
        </dl>

        <div class="mt-4 rounded-md border border-line-soft bg-surface-sunken/60 p-3">
          <p class="text-[11px] font-semibold uppercase tracking-wide text-muted">CPF / SHG preview</p>
          <dl class="mt-2 grid grid-cols-2 gap-2 text-[12.5px]">
            <div>
              <dt class="text-muted">CPF employee</dt>
              <dd class="font-semibold tabular-nums">{{ money(cpf?.employee_cents) }}</dd>
            </div>
            <div>
              <dt class="text-muted">CPF employer</dt>
              <dd class="font-semibold tabular-nums">{{ money(cpf?.employer_cents) }}</dd>
            </div>
            <div>
              <dt class="text-muted">SHG {{ shg?.agency || '' }}</dt>
              <dd class="font-semibold tabular-nums">{{ shg?.opt_out ? 'Opted out' : money(shg?.employee_cents) }}</dd>
            </div>
            <div>
              <dt class="text-muted">Rate source</dt>
              <dd class="font-semibold">{{ cpf?.rate_source || '—' }}</dd>
            </div>
          </dl>
          <p class="mt-2 text-[11px] text-muted">{{ estimate?.disclaimer }}</p>
        </div>
      </UiCard>

      <UiCard v-else-if="isLeft" tone="surface" class="mb-4">
        <p class="text-[13px] font-semibold text-ink">{{ leftBannerTitle }}</p>
        <p class="mt-1 text-[12.5px] text-muted">
          Showing issued and acknowledged payslips only. Live estimate returns when employment is active again.
        </p>
      </UiCard>

      <!-- Payslip history -->
      <UiCard tone="surface">
        <p class="text-[11px] font-semibold uppercase tracking-wide text-muted">Payslip history</p>
        <ul class="mt-2 divide-y divide-line-soft">
          <li v-for="p in snap.payslips" :key="p.id" class="flex items-center justify-between gap-3 py-2.5">
            <div>
              <p class="text-[13px] font-semibold tabular-nums text-ink">{{ p.period_start }} – {{ p.period_end }}</p>
              <p class="text-[11.5px] text-muted">{{ statusLabel(p.status) }} · net {{ money(p.net_cents) }}</p>
            </div>
            <NuxtLink
              :to="`/payslip/${p.token}`"
              class="press text-[12.5px] font-semibold text-brown"
            >Open →</NuxtLink>
          </li>
          <li v-if="!snap.payslips?.length" class="py-6 text-center text-[13px] text-muted">
            No issued payslips yet.
          </li>
        </ul>
      </UiCard>
    </template>

    <p v-else class="text-center text-[13px] text-muted">Loading…</p>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: 'auth' })

const route = useRoute()
const token = computed(() => String(route.params.token || ''))
const error = ref('')
const snap = ref<any>(null)

const { data, error: fetchErr } = await useFetch<any>(() => `/api/pay/${token.value}`, {
  watch: [token],
})
watchEffect(() => {
  if (fetchErr.value) error.value = (fetchErr.value as any)?.data?.message || 'Could not open pay portal.'
  else {
    error.value = ''
    snap.value = data.value?.data || null
  }
})

const estimate = computed(() => snap.value?.estimate || null)
const showLiveEstimate = computed(() => !!(snap.value?.live_eligible && estimate.value))
const isLeft = computed(() => {
  const s = snap.value?.staff?.employment_status
  return s === 'terminated' || s === 'inactive'
})
const leftBannerTitle = computed(() => {
  const s = snap.value?.staff?.employment_status
  if (s === 'inactive') return 'On break — history only'
  if (s === 'terminated') return 'Employment ended — history only'
  return 'Live estimate unavailable'
})
const cpf = computed(() => estimate.value?.statutory_preview?.cpf || null)
const shg = computed(() => estimate.value?.statutory_preview?.shg || null)

const employmentLabel = computed(() => {
  const t = snap.value?.staff?.employment_type
  const type = ({ full_time: 'Full-time', part_time: 'Part-time', contractor: 'Contractor' } as Record<string, string>)[t] || t || ''
  const s = snap.value?.staff?.employment_status
  const status = ({ active: '', inactive: 'On break', terminated: 'Terminated' } as Record<string, string>)[s] || ''
  return [type, status].filter(Boolean).join(' · ')
})
const basisLabel = computed(() => {
  const b = estimate.value?.period?.basis
  return ({
    pt_week: 'This week (Mon–Sun)',
    ft_mtd: 'Month to date',
    month: 'This month',
  } as Record<string, string>)[b] || (b || 'Current period')
})

function statusLabel(s: string) {
  return ({ issued: 'Issued', acknowledged: 'Signed off', disputed: 'Disputed' } as Record<string, string>)[s] || s
}
</script>