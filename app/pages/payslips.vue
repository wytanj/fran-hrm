<template>
  <div>
    <UiPageHeader eyebrow="Pay" title="My payslips" subtitle="Your issued payslips. Open one to view, print, acknowledge or raise a dispute." />

    <UiBusy :busy="pending" label="Loading…">
    <UiTable :columns="[
      { key: 'period', label: 'Period' },
      { key: 'paid', label: 'Paid' },
      { key: 'net', label: 'Net', align: 'right' },
      { key: 'status', label: 'Status', align: 'center', width: '130px' },
      { key: 'action', label: '', align: 'right', width: '90px' },
    ]">
      <tr v-for="p in payslips" :key="p.id" class="border-b border-line-soft last:border-0 hover:bg-surface-sunken/50">
        <td class="px-3.5 py-2.5 font-semibold tabular-nums text-ink">{{ p.period_start }} – {{ p.period_end }}</td>
        <td class="px-3.5 py-2.5 tabular-nums text-muted">{{ p.payment_date || '—' }}</td>
        <td class="px-3.5 py-2.5 text-right font-semibold tabular-nums">{{ money(p.net_cents, p.currency) }}</td>
        <td class="px-3.5 py-2.5 text-center"><UiBadge :tone="statusTone(p.status)">{{ statusLabel(p.status) }}</UiBadge></td>
        <td class="px-3.5 py-2.5 text-right">
          <NuxtLink :to="`/payslip/${p.token}`" class="press text-[12.5px] font-semibold text-brown">Open →</NuxtLink>
        </td>
      </tr>
      <tr v-if="!payslips.length">
        <td colspan="5" class="px-3.5 py-8 text-center text-[13px] text-muted">No payslips yet.</td>
      </tr>
    </UiTable>
    </UiBusy>
  </div>
</template>

<script setup lang="ts">
const { data: res, pending } = await useFetch<any>('/api/v1/payroll/payslips/mine', { lazy: true, default: () => ({ data: [] }) })
const payslips = computed<any[]>(() => res.value?.data || [])

function statusLabel(s: string) {
  return ({ issued: 'Issued', acknowledged: 'Signed off', disputed: 'Disputed' } as Record<string, string>)[s] || s
}
function statusTone(s: string) {
  return ({ acknowledged: 'success', disputed: 'danger', issued: 'warning' } as Record<string, string>)[s] || 'muted'
}
</script>
