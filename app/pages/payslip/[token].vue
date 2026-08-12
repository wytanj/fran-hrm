<template>
  <div class="mx-auto max-w-2xl">
    <div v-if="error" class="rounded-lg border border-line-soft bg-white p-8 text-center shadow-warm-sm">
      <p class="text-[14px] font-semibold text-ink">{{ error }}</p>
      <NuxtLink to="/payslips" class="press mt-3 inline-block text-[12.5px] font-semibold text-brown">My payslips →</NuxtLink>
    </div>

    <template v-else-if="slip">
      <!-- Actions (not printed) -->
      <div class="no-print mb-4 flex flex-wrap items-center gap-2">
        <UiBadge :tone="statusTone(slip.status)">{{ statusLabel(slip.status) }}</UiBadge>
        <div class="ml-auto flex flex-wrap gap-2">
          <UiButton size="sm" variant="secondary" @click="print">Print / PDF</UiButton>
          <UiButton v-if="can.issue" size="sm" :loading="busy" @click="act('issue')">Issue</UiButton>
          <UiButton v-if="can.revert" size="sm" variant="secondary" :loading="busy" @click="act('revert')">Revert to draft</UiButton>
          <UiButton v-if="can.acknowledge" size="sm" :loading="busy" @click="act('acknowledge')">Acknowledge</UiButton>
          <UiButton v-if="can.dispute" size="sm" variant="secondary" :loading="busy" @click="showDispute = true">Dispute</UiButton>
        </div>
      </div>

      <div v-if="showDispute" class="no-print mb-4 rounded-lg border border-danger/40 bg-danger-soft p-3.5">
        <p class="text-[12.5px] font-semibold text-danger">Raise a dispute</p>
        <textarea v-model="disputeReason" rows="2" placeholder="What's wrong with this payslip?"
          class="mt-2 w-full rounded-md border border-line bg-white p-2 text-[13px]" />
        <div class="mt-2 flex gap-2">
          <UiButton size="sm" :loading="busy" :disabled="!disputeReason.trim()" @click="act('dispute')">Submit dispute</UiButton>
          <UiButton size="sm" variant="ghost" @click="showDispute = false">Cancel</UiButton>
        </div>
      </div>

      <!-- The payslip document -->
      <div class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
        <div class="border-b border-line-soft px-6 py-5">
          <div class="flex items-start justify-between gap-4">
            <div>
              <p class="font-display text-[20px] font-bold text-ink">{{ slip.employer_name || 'Employer' }}</p>
              <p class="text-[12px] text-muted">Itemised payslip</p>
            </div>
            <div class="text-right text-[12px] text-muted">
              <p><span class="text-ink-soft">Pay period</span><br>{{ slip.period_start }} – {{ slip.period_end }}</p>
              <p v-if="slip.payment_date" class="mt-1"><span class="text-ink-soft">Payment date</span><br>{{ slip.payment_date }}</p>
            </div>
          </div>
          <div class="mt-4 flex items-baseline gap-2">
            <p class="text-[14px] font-semibold text-ink">{{ slip.employee_name || slip.staff?.display_name }}</p>
            <p class="font-mono text-[11.5px] text-muted">{{ slip.staff?.employee_code }}</p>
          </div>
        </div>

        <div class="grid gap-0 sm:grid-cols-2">
          <!-- Earnings -->
          <div class="border-b border-line-soft p-6 sm:border-b-0 sm:border-r">
            <p class="mb-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Earnings</p>
            <Row label="Basic salary" :value="money(slip.basic_salary_cents, slip.currency)" />
            <Row v-for="(a, i) in slip.allowances" :key="`a${i}`" :label="a.label || 'Allowance'" :value="money(a.cents, slip.currency)" />
            <Row v-for="(a, i) in slip.additions" :key="`p${i}`" :label="a.label || 'Payment'" :value="money(a.cents, slip.currency)" />
            <Row v-if="slip.overtime_pay_cents" :label="`Overtime (${slip.overtime_hours}h)`" :value="money(slip.overtime_pay_cents, slip.currency)" />
            <div class="mt-2 flex justify-between border-t border-line-soft pt-2 text-[13px] font-semibold">
              <span>Gross</span><span class="tabular-nums">{{ money(slip.gross_cents, slip.currency) }}</span>
            </div>
          </div>
          <!-- Deductions -->
          <div class="p-6">
            <p class="mb-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Deductions</p>
            <Row label="CPF (employee)" :value="money(slip.cpf_employee_cents, slip.currency)" />
            <Row v-for="(d, i) in slip.deductions" :key="`d${i}`" :label="d.label || 'Deduction'" :value="money(d.cents, slip.currency)" />
            <div class="mt-2 flex justify-between border-t border-line-soft pt-2 text-[13px] font-semibold">
              <span>Total deductions</span><span class="tabular-nums">{{ money(totalDeductions, slip.currency) }}</span>
            </div>
          </div>
        </div>

        <div class="flex items-center justify-between bg-surface-sunken px-6 py-4">
          <span class="text-[13px] font-semibold text-ink">Net pay</span>
          <span class="font-display text-[22px] font-bold tabular-nums text-ink">{{ money(slip.net_cents, slip.currency) }}</span>
        </div>
        <p class="px-6 py-2 text-[11px] text-muted">Employer CPF contribution: {{ money(slip.cpf_employer_cents, slip.currency) }} (not deducted from pay).</p>
      </div>

      <!-- Dispute / comment log -->
      <div class="mt-5">
        <h2 class="mb-2 font-display text-[15px] font-bold text-ink">Discussion & disputes</h2>
        <div class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-xs">
          <div v-for="c in slip.comments" :key="c.id" class="border-b border-line-soft px-4 py-2.5 last:border-0">
            <div class="flex items-center gap-2 text-[11.5px] text-muted">
              <UiBadge v-if="c.kind !== 'comment'" :tone="c.kind === 'dispute' ? 'danger' : 'success'">{{ c.kind }}</UiBadge>
              <span class="font-semibold text-ink-soft">{{ c.author_name || 'Someone' }}</span>
              <span>{{ fmtDateTime(c.created_at) }}</span>
            </div>
            <p class="mt-0.5 text-[13px] text-ink">{{ c.body }}</p>
          </div>
          <div v-if="!slip.comments.length" class="px-4 py-4 text-[12.5px] text-muted">No comments yet.</div>
          <div v-if="can.comment" class="no-print flex gap-2 border-t border-line-soft p-3">
            <input v-model="commentBody" placeholder="Add a comment…" class="h-9 flex-1 rounded-md border border-line bg-white px-2.5 text-[13px]"
              @keyup.enter="act('comment')">
            <UiButton size="sm" :loading="busy" :disabled="!commentBody.trim()" @click="act('comment')">Post</UiButton>
          </div>
        </div>
      </div>
      <p v-if="msg" class="no-print mt-3 text-[12.5px]" :class="msgErr ? 'text-danger' : 'text-success'">{{ msg }}</p>
    </template>
  </div>
</template>

<script setup lang="ts">
const Row = defineComponent({
  props: { label: String, value: String },
  setup: (p) => () => h('div', { class: 'flex justify-between py-1 text-[13px]' }, [
    h('span', { class: 'text-ink-soft' }, p.label), h('span', { class: 'tabular-nums text-ink' }, p.value),
  ]),
})

const route = useRoute()
const token = computed(() => String(route.params.token))
const { data: res, refresh, error: fetchErr } = await useFetch<any>(() => `/api/v1/payroll/payslips/${token.value}`, { lazy: true })
const slip = computed<any>(() => res.value?.data)
const can = computed<any>(() => res.value?.can || {})
const error = computed(() => (fetchErr.value ? (fetchErr.value as any)?.data?.message || 'Payslip not found' : ''))

const totalDeductions = computed(() =>
  (slip.value?.cpf_employee_cents || 0) + (slip.value?.deductions || []).reduce((s: number, d: any) => s + (Number(d.cents) || 0), 0))

const busy = ref(false)
const msg = ref('')
const msgErr = ref(false)
const showDispute = ref(false)
const disputeReason = ref('')
const commentBody = ref('')

async function act(action: string) {
  busy.value = true; msg.value = ''; msgErr.value = false
  try {
    const body: any = { action }
    if (action === 'dispute' || action === 'revert') body.reason = disputeReason.value
    if (action === 'comment') body.body = commentBody.value
    const r: any = await $fetch(`/api/v1/payroll/payslips/${token.value}/action`, { method: 'POST', body })
    msg.value = r.note || 'Done.'
    showDispute.value = false; disputeReason.value = ''; commentBody.value = ''
    await refresh()
  } catch (err: any) { msgErr.value = true; msg.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { busy.value = false }
}

function print() { window.print() }
function statusLabel(s: string) {
  return ({ draft: 'Draft', issued: 'Issued', acknowledged: 'Signed off', disputed: 'Disputed' } as Record<string, string>)[s] || s
}
function statusTone(s: string) {
  return ({ acknowledged: 'success', disputed: 'danger', issued: 'warning', draft: 'muted' } as Record<string, string>)[s] || 'muted'
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })
}
</script>
