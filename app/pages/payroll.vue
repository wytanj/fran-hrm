<template>
  <div>
    <UiPageHeader eyebrow="Finance" title="Payroll" subtitle="Create itemised payslips, issue them for sign-off, and settle disputes. Finance and HQ only." />

    <div class="grid gap-5 lg:grid-cols-3">
      <!-- Create -->
      <div class="lg:col-span-2">
        <div class="rounded-lg border border-line bg-white p-4 shadow-warm-xs">
          <h2 class="font-display text-[16px] font-bold text-ink">New payslip</h2>
          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Staff</span>
              <select v-model="form.staff_id" class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
                <option value="">Select…</option>
                <option v-for="m in members" :key="m.id" :value="m.id">{{ m.display_name }} ({{ m.employee_code }})</option>
              </select>
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Payment date</span>
              <input v-model="form.payment_date" type="date" class="h-9 w-full rounded-md border border-line bg-white px-2.5 text-[13px]">
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Period start</span>
              <input v-model="form.period_start" type="date" class="h-9 w-full rounded-md border border-line bg-white px-2.5 text-[13px]">
            </label>
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Period end</span>
              <input v-model="form.period_end" type="date" class="h-9 w-full rounded-md border border-line bg-white px-2.5 text-[13px]">
            </label>
          </div>

          <div class="mt-3 grid gap-3 sm:grid-cols-2">
            <MoneyField v-model="form.basic" label="Monthly basic salary" />
            <MoneyField v-model="form.overtime_pay" label="Overtime pay" />
            <label class="block">
              <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Overtime hours</span>
              <input v-model.number="form.overtime_hours" type="number" min="0" step="0.5" class="h-9 w-full rounded-md border border-line bg-white px-2.5 text-[13px]">
            </label>
            <MoneyField v-model="form.cpf_employee" label="CPF — employee (deducted)" />
            <MoneyField v-model="form.cpf_employer" label="CPF — employer (info)" />
          </div>

          <!-- Allowances / deductions -->
          <div class="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Allowances / additions</span>
                <button class="press text-[12px] font-semibold text-brown" @click="form.allowances.push({ label: '', amount: 0 })">+ Add</button>
              </div>
              <div v-for="(a, i) in form.allowances" :key="`a${i}`" class="mt-1.5 flex gap-1.5">
                <input v-model="a.label" placeholder="Label" class="h-8 flex-1 rounded-md border border-line bg-white px-2 text-[12.5px]">
                <input v-model.number="a.amount" type="number" step="0.01" placeholder="0.00" class="h-8 w-24 rounded-md border border-line bg-white px-2 text-right text-[12.5px]">
                <button class="press px-1 text-danger" @click="form.allowances.splice(i, 1)">✕</button>
              </div>
            </div>
            <div>
              <div class="flex items-center justify-between">
                <span class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Deductions (excl. CPF)</span>
                <button class="press text-[12px] font-semibold text-brown" @click="form.deductions.push({ label: '', amount: 0 })">+ Add</button>
              </div>
              <div v-for="(d, i) in form.deductions" :key="`d${i}`" class="mt-1.5 flex gap-1.5">
                <input v-model="d.label" placeholder="Label" class="h-8 flex-1 rounded-md border border-line bg-white px-2 text-[12.5px]">
                <input v-model.number="d.amount" type="number" step="0.01" placeholder="0.00" class="h-8 w-24 rounded-md border border-line bg-white px-2 text-right text-[12.5px]">
                <button class="press px-1 text-danger" @click="form.deductions.splice(i, 1)">✕</button>
              </div>
            </div>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-4 border-t border-line-soft pt-3">
            <span class="text-[12.5px] text-muted">Gross <strong class="text-ink">{{ money(grossCents) }}</strong></span>
            <span class="text-[12.5px] text-muted">Net <strong class="text-ink">{{ money(netCents) }}</strong></span>
            <UiButton class="ml-auto" :loading="creating" :disabled="!form.staff_id || !form.period_start || !form.period_end" @click="create">Create draft</UiButton>
          </div>
          <p v-if="msg" class="mt-2 text-[12.5px]" :class="msgErr ? 'text-danger' : 'text-success'">{{ msg }}</p>
        </div>
      </div>

      <!-- Info -->
      <div>
        <div class="rounded-lg border border-line-soft bg-surface-sunken p-4 text-[12px] leading-relaxed text-ink-soft">
          <p class="text-[13px] font-semibold text-ink">How it works</p>
          <ol class="mt-2 list-inside list-decimal space-y-1">
            <li>Create a draft and check the figures.</li>
            <li>Open it and <strong>Issue</strong> — that's your sign-off; amounts lock.</li>
            <li>The staff member <strong>acknowledges</strong> (both signed) or <strong>disputes</strong> it.</li>
            <li>Disputes and comments are kept as a permanent log.</li>
          </ol>
          <p class="mt-2 text-[11.5px]">Monthly basic is <strong>prorated automatically</strong> for approved no-pay leave / sabbaticals in the period.</p>
          <p class="mt-1 text-[11.5px]">Every payslip has its own link — open it to print a PDF.</p>
        </div>

        <div class="mt-4 rounded-lg border border-line bg-white p-4 shadow-warm-xs">
          <h3 class="font-display text-[14px] font-bold text-ink">CPF EZPay template</h3>
          <p class="mt-1 text-[12px] text-muted">Generate the CPF Board upload file for a month, from that month's issued payslips + staff CPF details.</p>
          <div class="mt-2 flex items-center gap-2">
            <input v-model="ezpayMonth" type="month" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px]">
            <a class="press inline-flex h-9 items-center rounded-md bg-yellow px-3 text-[12.5px] font-semibold text-brown shadow-glow"
              :class="!ezpayMonth ? 'pointer-events-none opacity-40' : ''" :href="`/api/v1/payroll/cpf-ezpay?month=${ezpayMonth}`" download>Download CSV</a>
          </div>
          <p class="mt-1.5 text-[11px] text-muted">Foreigners (CPF-not-applicable) and anyone missing an NRIC are skipped.</p>
        </div>
      </div>
    </div>

    <!-- List -->
    <h2 class="mb-2 mt-6 font-display text-[16px] font-bold text-ink">Payslips</h2>
    <UiBusy :busy="pending" label="Loading…">
    <UiTable :columns="[
      { key: 'staff', label: 'Staff' },
      { key: 'period', label: 'Period' },
      { key: 'net', label: 'Net', align: 'right' },
      { key: 'status', label: 'Status', align: 'center', width: '120px' },
      { key: 'action', label: '', align: 'right', width: '90px' },
    ]">
      <tr v-for="p in payslips" :key="p.id" class="border-b border-line-soft last:border-0 hover:bg-surface-sunken/50">
        <td class="px-3.5 py-2.5 font-semibold text-ink">{{ p.staff?.display_name }}</td>
        <td class="px-3.5 py-2.5 tabular-nums text-muted">{{ p.period_start }} – {{ p.period_end }}</td>
        <td class="px-3.5 py-2.5 text-right font-semibold tabular-nums">{{ money(p.net_cents, p.currency) }}</td>
        <td class="px-3.5 py-2.5 text-center"><UiBadge :tone="statusTone(p.status)">{{ p.status }}</UiBadge></td>
        <td class="px-3.5 py-2.5 text-right"><NuxtLink :to="`/payslip/${p.token}`" class="press text-[12.5px] font-semibold text-brown">Open →</NuxtLink></td>
      </tr>
      <tr v-if="!payslips.length">
        <td colspan="5" class="px-3.5 py-8 text-center text-[13px] text-muted">No payslips yet.</td>
      </tr>
    </UiTable>
    </UiBusy>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['payroll-only'] })

const MoneyField = defineComponent({
  props: { modelValue: Number, label: String },
  emits: ['update:modelValue'],
  setup: (p, { emit }) => () => h('label', { class: 'block' }, [
    h('span', { class: 'mb-1 block text-[11px] font-semibold text-ink-soft' }, p.label),
    h('input', {
      type: 'number', step: '0.01', min: '0',
      value: p.modelValue,
      onInput: (e: any) => emit('update:modelValue', Number(e.target.value) || 0),
      class: 'h-9 w-full rounded-md border border-line bg-white px-2.5 text-right text-[13px] tabular-nums',
    }),
  ]),
})

const form = reactive<any>({
  staff_id: '', period_start: '', period_end: '', payment_date: '',
  basic: 0, overtime_hours: 0, overtime_pay: 0, cpf_employee: 0, cpf_employer: 0,
  allowances: [], deductions: [], notes: '',
})

const { data: membersRes } = await useFetch<any>('/api/v1/staff', { query: { limit: 200, employment_status: 'active' }, lazy: true, default: () => ({ data: [] }) })
const members = computed<any[]>(() => membersRes.value?.data || [])

const { data: listRes, refresh, pending } = await useFetch<any>('/api/v1/payroll/payslips', { lazy: true, default: () => ({ data: [] }) })
const payslips = computed<any[]>(() => listRes.value?.data || [])

const c = (n: number) => Math.round((Number(n) || 0) * 100)
const sum = (arr: any[]) => (arr || []).reduce((s, x) => s + c(x.amount), 0)
const grossCents = computed(() => c(form.basic) + sum(form.allowances) + c(form.overtime_pay))
const netCents = computed(() => grossCents.value - sum(form.deductions) - c(form.cpf_employee))

const ezpayMonth = ref('')
const creating = ref(false)
const msg = ref('')
const msgErr = ref(false)

async function create() {
  creating.value = true; msg.value = ''; msgErr.value = false
  try {
    const r: any = await $fetch('/api/v1/payroll/payslips', {
      method: 'POST',
      body: {
        staff_id: form.staff_id,
        period_start: form.period_start, period_end: form.period_end,
        payment_date: form.payment_date || undefined,
        // Sent as the monthly rate — the server prorates it for approved no-pay
        // leave / sabbatical in the period.
        monthly_basic_cents: c(form.basic),
        allowances: form.allowances.filter((a: any) => a.label || a.amount).map((a: any) => ({ label: a.label, cents: c(a.amount) })),
        deductions: form.deductions.filter((d: any) => d.label || d.amount).map((d: any) => ({ label: d.label, cents: c(d.amount) })),
        overtime_hours: form.overtime_hours,
        overtime_pay_cents: c(form.overtime_pay),
        cpf_employee_cents: c(form.cpf_employee),
        cpf_employer_cents: c(form.cpf_employer),
        notes: form.notes || undefined,
      },
    })
    const pr = r.data?.proration
    msg.value = pr && pr.no_pay_days > 0
      ? `Draft created for ${r.data.employee_name}. Prorated for ${pr.no_pay_days} no-pay day(s) → basic ${money(pr.prorated_basic_cents)}. Open it to issue.`
      : `Draft created for ${r.data.employee_name}. Open it to issue.`
    Object.assign(form, { basic: 0, overtime_hours: 0, overtime_pay: 0, cpf_employee: 0, cpf_employer: 0, allowances: [], deductions: [], notes: '' })
    await refresh()
  } catch (err: any) { msgErr.value = true; msg.value = err?.data?.message || err?.data?.statusMessage || 'Failed' } finally { creating.value = false }
}

function statusTone(s: string) {
  return ({ acknowledged: 'success', disputed: 'danger', issued: 'warning', draft: 'muted' } as Record<string, string>)[s] || 'muted'
}
</script>
