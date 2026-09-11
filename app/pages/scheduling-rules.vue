<template>
  <div>
    <UiPageHeader eyebrow="Scheduling" title="Scheduling rules"
      subtitle="The one rulebook the Telegram bot, the reminders and the availability lock all follow. Change a value here and it takes effect on the next message — no deploy.">
      <template #actions>
        <UiBadge :tone="res?.source === 'workspace' ? 'primary' : 'muted'">
          {{ res?.source === 'workspace' ? `workspace v${res?.version}` : `file defaults v${res?.version}` }}
        </UiBadge>
        <UiButton v-if="canEdit" size="sm" variant="secondary" :disabled="!dirty || saving" @click="reload">Discard</UiButton>
        <UiButton v-if="canEdit" size="sm" :loading="saving" :disabled="!dirty" @click="save">Save &amp; bump version</UiButton>
      </template>
    </UiPageHeader>

    <UiBusy :busy="pending" label="Loading rules…">
      <div v-if="fetchErr" class="rounded-lg border border-danger/30 bg-danger-soft p-4 text-[13px] text-danger">{{ errorText(fetchErr) }}</div>
      <template v-else-if="form">
        <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <UiStat label="Version" :value="`v${res?.version}`" :hint="res?.source === 'workspace' ? `edited ${fmtWhen(res?.updated_at)}${res?.updated_by_name ? ' by ' + res.updated_by_name : ''}` : 'from config/scheduling_rules.json'" />
          <UiStat label="Live window" :value="monthLabel(res?.current_window?.month)" :hint="windowHint" :tone="res?.current_window?.state === 'locked' ? 'warning' : 'ink'" />
          <UiStat label="Lock day" :value="form.availability.lock_day_of_prior_month" unit="of prior month" :hint="`opens day ${form.availability.open_day_of_prior_month}`" />
          <UiStat label="Publish target" :value="form.publish.target_day_of_prior_month" unit="of prior month" hint="roster should be live by" />
        </div>

        <p v-if="!canEdit" class="mb-4 rounded-lg border border-line bg-surface-sunken px-3.5 py-2.5 text-[12.5px] text-ink-soft">
          You can read the rules but not change them. Editing needs the "Build rosters for others" (roster:write) permission — ask a store manager or an HQ admin.
        </p>

        <div class="grid gap-5 lg:grid-cols-2">
          <!-- Availability -->
          <section class="rounded-lg border border-line-soft bg-white shadow-warm-sm">
            <header class="border-b border-line-soft px-4 py-2.5">
              <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Availability window</p>
              <p class="mt-0.5 text-[12px] text-ink-soft">Staff submit next month's availability between these two days of the current month. After the lock day, self-service edits are refused (managers can still edit).</p>
            </header>
            <table class="w-full text-[13px]">
              <tbody>
                <tr class="border-b border-line-soft">
                  <td class="px-4 py-2.5 font-semibold text-ink">Opens on day</td>
                  <td class="px-4 py-2 text-right">
                    <input v-model.number="form.availability.open_day_of_prior_month" type="number" min="1" max="28" :disabled="!canEdit" class="num">
                  </td>
                </tr>
                <tr class="border-b border-line-soft">
                  <td class="px-4 py-2.5 font-semibold text-ink">Locks at end of day</td>
                  <td class="px-4 py-2 text-right">
                    <input v-model.number="form.availability.lock_day_of_prior_month" type="number" min="1" max="28" :disabled="!canEdit" class="num">
                  </td>
                </tr>
                <tr>
                  <td class="px-4 py-2.5 align-top">
                    <p class="font-semibold text-ink">Reminders</p>
                    <p class="mt-0.5 text-[11.5px] text-muted">In-app + Telegram (if linked). Runs daily at 09:00 SGT.</p>
                  </td>
                  <td class="px-4 py-2">
                    <div class="flex flex-wrap justify-end gap-1.5">
                      <button v-for="tok in reminderChoices" :key="tok" type="button" :disabled="!canEdit"
                        class="press rounded-md border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-60"
                        :class="form.availability.reminders.includes(tok) ? 'border-yellow-deep bg-yellow-soft text-brown' : 'border-line bg-white text-muted'"
                        @click="toggleList(form.availability.reminders, tok)">
                        {{ reminderLabel(tok) }}
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Publish -->
          <section class="rounded-lg border border-line-soft bg-white shadow-warm-sm">
            <header class="border-b border-line-soft px-4 py-2.5">
              <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Publish</p>
              <p class="mt-0.5 text-[12px] text-ink-soft">When the month's rosters should be published, and which guardrails are checked before publishing.</p>
            </header>
            <table class="w-full text-[13px]">
              <tbody>
                <tr class="border-b border-line-soft">
                  <td class="px-4 py-2.5 font-semibold text-ink">Target day of prior month</td>
                  <td class="px-4 py-2 text-right">
                    <input v-model.number="form.publish.target_day_of_prior_month" type="number" min="1" max="28" :disabled="!canEdit" class="num">
                  </td>
                </tr>
                <tr>
                  <td class="px-4 py-2.5 align-top font-semibold text-ink">Guardrails</td>
                  <td class="px-4 py-2">
                    <div class="flex flex-wrap justify-end gap-1.5">
                      <button v-for="g in res?.options?.guardrails || []" :key="g" type="button" :disabled="!canEdit"
                        class="press rounded-md border px-2.5 py-1 text-[12px] font-semibold disabled:opacity-60"
                        :class="form.publish.guardrails.includes(g) ? 'border-yellow-deep bg-yellow-soft text-brown' : 'border-line bg-white text-muted'"
                        @click="toggleList(form.publish.guardrails, g)">
                        {{ guardrailLabel(g) }}
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Cover -->
          <section class="rounded-lg border border-line-soft bg-white shadow-warm-sm">
            <header class="border-b border-line-soft px-4 py-2.5">
              <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Cover &amp; swaps</p>
              <p class="mt-0.5 text-[12px] text-ink-soft">Fixed now so the bot behaves predictably when cover flows ship (P2). Stored, not yet enforced.</p>
            </header>
            <table class="w-full text-[13px]">
              <tbody>
                <tr class="border-b border-line-soft">
                  <td class="px-4 py-2.5 font-semibold text-ink">Planned swap needs (days' notice)</td>
                  <td class="px-4 py-2 text-right"><input v-model.number="form.cover.planned_swap_min_days" type="number" min="0" max="60" :disabled="!canEdit" class="num"></td>
                </tr>
                <tr class="border-b border-line-soft">
                  <td class="px-4 py-2.5 font-semibold text-ink">Escalate to manager (hours before start)</td>
                  <td class="px-4 py-2 text-right"><input v-model.number="form.cover.escalate_hours_before_start" type="number" min="0" max="168" :disabled="!canEdit" class="num"></td>
                </tr>
                <tr class="border-b border-line-soft">
                  <td class="px-4 py-2.5 font-semibold text-ink">Urgent cover: auto-accept first claim</td>
                  <td class="px-4 py-2 text-right"><Toggle v-model="form.cover.urgent_auto_accept_first_claim" :disabled="!canEdit" /></td>
                </tr>
                <tr>
                  <td class="px-4 py-2.5 font-semibold text-ink">MC automatically opens cover</td>
                  <td class="px-4 py-2 text-right"><Toggle v-model="form.cover.mc_auto_open_cover" :disabled="!canEdit" /></td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Telegram + stores -->
          <section class="rounded-lg border border-line-soft bg-white shadow-warm-sm">
            <header class="border-b border-line-soft px-4 py-2.5">
              <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Telegram pilot &amp; stores</p>
              <p class="mt-0.5 text-[12px] text-ink-soft">Which stores these rules and reminders apply to (store codes; empty = all), and whether the bot requires a linked identity.</p>
            </header>
            <table class="w-full text-[13px]">
              <tbody>
                <tr class="border-b border-line-soft">
                  <td class="px-4 py-2.5 align-top">
                    <p class="font-semibold text-ink">Store codes</p>
                    <p class="mt-0.5 text-[11.5px] text-muted">Comma-separated. Codes in this workspace: {{ storeCodes.join(', ') || '—' }}</p>
                  </td>
                  <td class="px-4 py-2 text-right">
                    <input v-model="storeIdsText" type="text" :disabled="!canEdit" class="txt" placeholder="SGP-BUGIS-001">
                  </td>
                </tr>
                <tr class="border-b border-line-soft">
                  <td class="px-4 py-2.5 font-semibold text-ink">Telegram pilot on</td>
                  <td class="px-4 py-2 text-right"><Toggle v-model="form.telegram.pilot" :disabled="!canEdit" /></td>
                </tr>
                <tr>
                  <td class="px-4 py-2.5 font-semibold text-ink">Bot requires linked identity</td>
                  <td class="px-4 py-2 text-right"><Toggle v-model="form.telegram.require_linked_identity" :disabled="!canEdit" /></td>
                </tr>
              </tbody>
            </table>
          </section>

          <!-- Pricing / pay (read-mostly) -->
          <section class="rounded-lg border border-line-soft bg-white shadow-warm-sm lg:col-span-2">
            <header class="border-b border-line-soft px-4 py-2.5">
              <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Pricing &amp; pay basis (P3/P4 — recorded now, applied later)</p>
            </header>
            <table class="w-full text-[13px]">
              <tbody>
                <tr class="border-b border-line-soft">
                  <td class="px-4 py-2.5 font-semibold text-ink">Pricing basis</td>
                  <td class="px-4 py-2 text-right">
                    <select v-model="form.pricing.default_basis" :disabled="!canEdit" class="txt w-auto">
                      <option v-for="b in res?.options?.pricing_bases || []" :key="b" :value="b">{{ b }}</option>
                    </select>
                  </td>
                </tr>
                <tr class="border-b border-line-soft">
                  <td class="px-4 py-2.5 align-top">
                    <p class="font-semibold text-ink">Template multipliers</p>
                    <p class="mt-0.5 text-[11.5px] text-muted">Shift template name → multiplier on the person's hourly rate.</p>
                  </td>
                  <td class="px-4 py-2">
                    <div class="flex flex-col items-end gap-1.5">
                      <div v-for="(row, idx) in multipliers" :key="idx" class="flex items-center gap-1.5">
                        <input v-model="row.name" type="text" :disabled="!canEdit" class="txt w-36" placeholder="closing">
                        <span class="text-muted">×</span>
                        <input v-model.number="row.value" type="number" step="0.05" min="0.05" max="10" :disabled="!canEdit" class="num">
                        <button v-if="canEdit" type="button" class="press text-[12px] text-muted" title="Remove" @click="multipliers.splice(idx, 1)">✕</button>
                      </div>
                      <button v-if="canEdit" type="button" class="press text-[12px] font-semibold text-brown" @click="multipliers.push({ name: '', value: 1 })">+ add template</button>
                    </div>
                  </td>
                </tr>
                <tr>
                  <td class="px-4 py-2.5 font-semibold text-ink">Pay v1 basis</td>
                  <td class="px-4 py-2 text-right">
                    <select v-model="form.pay.v1_basis" :disabled="!canEdit" class="txt w-auto">
                      <option v-for="b in res?.options?.pay_bases || []" :key="b" :value="b">{{ b }}</option>
                    </select>
                  </td>
                </tr>
              </tbody>
            </table>
          </section>
        </div>

        <div v-if="errors.length" class="mt-4 rounded-lg border border-danger/30 bg-danger-soft p-3.5 text-[12.5px] text-danger">
          <p class="font-semibold">Not saved:</p>
          <ul class="mt-1 list-disc pl-5">
            <li v-for="e in errors" :key="e">{{ e }}</li>
          </ul>
        </div>
        <p v-if="message" class="mt-3 text-[12.5px]" :class="messageTone === 'error' ? 'text-danger' : 'text-success'">{{ message }}</p>

        <div class="mt-6 flex flex-wrap items-center gap-3">
          <button type="button" class="press text-[12.5px] font-semibold text-brown underline decoration-brown/30" @click="showJson = !showJson">
            {{ showJson ? 'Hide' : 'Show' }} JSON
          </button>
          <button v-if="canEdit && res?.source === 'workspace'" type="button" class="press text-[12.5px] font-semibold text-muted" :disabled="saving" @click="reset">
            Reset to file defaults
          </button>
          <NuxtLink to="/scheduling-truth" class="press text-[12.5px] font-semibold text-brown">See the truth panel →</NuxtLink>
        </div>
        <pre v-if="showJson" class="mt-3 max-h-[60vh] overflow-auto rounded-lg border border-line-soft bg-white px-4 py-3 font-mono text-[11.5px] leading-relaxed text-ink shadow-warm-xs">{{ jsonText }}</pre>

        <p class="mt-4 max-w-3xl text-[11.5px] leading-relaxed text-muted">
          Defaults live in <code class="font-mono">config/scheduling_rules.json</code> (git). Saving here writes a workspace
          override and bumps the version; every change is in the audit trail. "Reset to file defaults" removes the override.
          Same doctrine as the people schema: one rulebook in force, versioned.
        </p>
      </template>
    </UiBusy>
  </div>
</template>

<script setup lang="ts">
import { defineComponent, h } from 'vue'

definePageMeta({ middleware: ['supervisor-only'] })

// Tiny inline toggle so this page has no new component dependency.
const Toggle = defineComponent({
  props: { modelValue: Boolean, disabled: Boolean },
  emits: ['update:modelValue'],
  setup(props, { emit }) {
    return () => h('button', {
      type: 'button',
      disabled: props.disabled,
      role: 'switch',
      'aria-checked': props.modelValue,
      class: [
        'press relative inline-flex h-6 w-11 items-center rounded-full border transition disabled:opacity-60',
        props.modelValue ? 'border-yellow-deep bg-yellow' : 'border-line bg-surface-sunken',
      ],
      onClick: () => emit('update:modelValue', !props.modelValue),
    }, [h('span', { class: ['inline-block h-4 w-4 rounded-full bg-brown transition', props.modelValue ? 'translate-x-6' : 'translate-x-1'] })])
  },
})

const { data: res, pending, error: fetchErr, refresh } = await useFetch<any>('/api/v1/scheduling-rules', { key: 'scheduling-rules' })
const { data: storesRes } = await useFetch<any>('/api/v1/stores', { default: () => ({ data: [] }), lazy: true })
const storeCodes = computed<string[]>(() => (storesRes.value?.data || []).map((s: any) => s.code))

const canEdit = computed(() => !!res.value?.can_edit)
const form = ref<any>(null)
const multipliers = ref<{ name: string; value: number }[]>([])
const storeIdsText = ref('')
const saving = ref(false)
const errors = ref<string[]>([])
const message = ref('')
const messageTone = ref<'ok' | 'error'>('ok')
const showJson = ref(false)
const snapshot = ref('')

const reminderChoices = ['open', 'T-7d', 'T-3d', 'T-1d', 'locked']

function load() {
  const rules = res.value?.data
  if (!rules) return
  form.value = JSON.parse(JSON.stringify(rules))
  multipliers.value = Object.entries(rules.pricing?.template_multipliers || {}).map(([name, value]) => ({ name, value: Number(value) }))
  storeIdsText.value = (rules.store_ids || []).join(', ')
  snapshot.value = JSON.stringify(compose())
  errors.value = []
}
watch(res, load, { immediate: true })

function compose() {
  if (!form.value) return null
  const out = JSON.parse(JSON.stringify(form.value))
  out.store_ids = storeIdsText.value.split(',').map((s) => s.trim()).filter(Boolean)
  out.pricing.template_multipliers = Object.fromEntries(
    multipliers.value.filter((m) => m.name.trim()).map((m) => [m.name.trim(), Number(m.value)]),
  )
  // Keep custom tokens that are not in the quick-pick list.
  return out
}

const dirty = computed(() => JSON.stringify(compose()) !== snapshot.value)
const jsonText = computed(() => JSON.stringify(compose(), null, 2))

function toggleList(list: string[], tok: string) {
  if (!canEdit.value) return
  const i = list.indexOf(tok)
  if (i === -1) list.push(tok); else list.splice(i, 1)
}

async function save() {
  if (!form.value) return
  saving.value = true; errors.value = []; message.value = ''
  try {
    await $fetch('/api/v1/scheduling-rules', { method: 'PUT', body: { rules: compose() } })
    await refresh()
    messageTone.value = 'ok'
    message.value = `Saved as v${res.value?.version}. The bot and reminders use it from the next message.`
  } catch (err: any) {
    messageTone.value = 'error'
    errors.value = err?.data?.data?.errors || []
    message.value = errors.value.length ? '' : errorText(err)
  } finally { saving.value = false }
}

async function reset() {
  if (!confirm('Remove the workspace override and go back to the file defaults?')) return
  saving.value = true; message.value = ''
  try {
    await $fetch('/api/v1/scheduling-rules', { method: 'PUT', body: { reset: true } })
    await refresh()
    messageTone.value = 'ok'; message.value = 'Back on file defaults.'
  } catch (err: any) {
    messageTone.value = 'error'; message.value = errorText(err)
  } finally { saving.value = false }
}

function reload() { load(); message.value = '' }

const windowHint = computed(() => {
  const w = res.value?.current_window
  if (!w) return ''
  if (w.state === 'upcoming') return `opens ${w.open_date}`
  if (w.state === 'open') return `closes end of ${w.lock_date} (${w.days_until_lock}d)`
  return `locked since ${w.locked_from}`
})

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
function monthLabel(m?: string) {
  if (!m) return '—'
  return `${MONTHS[Number(m.slice(5, 7)) - 1]?.slice(0, 3)} ${m.slice(0, 4)}`
}
function reminderLabel(tok: string) {
  if (tok === 'open') return 'On open'
  if (tok === 'locked') return 'When locked'
  return `${tok.replace('T-', '').replace('d', '')} day(s) before lock`
}
function guardrailLabel(g: string) {
  return ({ leave_block: 'Leave clash', ot_warn: 'OT projection', rest_warn: 'No rest day', pt_cap_warn: 'PT cap' } as any)[g] || g
}
function fmtWhen(iso?: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-SG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' })
}
function errorText(err: any) {
  return err?.data?.message || err?.data?.statusMessage || err?.message || 'Something went wrong'
}
</script>

<style scoped>
.num {
  @apply h-8 w-20 rounded-md border border-line bg-white px-2 text-right text-[13px] tabular-nums text-ink focus:border-brown focus:outline-none disabled:opacity-60;
}
.txt {
  @apply h-8 w-full max-w-[280px] rounded-md border border-line bg-white px-2 text-[13px] text-ink focus:border-brown focus:outline-none disabled:opacity-60;
}
</style>
