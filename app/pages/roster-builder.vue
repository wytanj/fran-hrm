<template>
  <div>
    <UiPageHeader eyebrow="Scheduling" title="Roster builder"
      subtitle="Generate a week from constraints, or import the sheet you already keep. Both produce a draft you review before publishing.">
      <template #actions>
        <select v-model="storeId" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px] font-medium">
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
        <input v-model="weekStart" type="date" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px]">
      </template>
    </UiPageHeader>

    <div class="mb-5 flex gap-1 border-b border-line">
      <button v-for="t in tabs" :key="t.key" type="button"
        class="press -mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold"
        :class="tab === t.key ? 'border-yellow-deep text-ink' : 'border-transparent text-muted hover:text-ink-soft'"
        @click="tab = t.key">
        {{ t.label }}
      </button>
    </div>

    <!-- ════════ GENERATE ════════ -->
    <template v-if="tab === 'generate'">
      <div class="grid gap-5 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <div class="rounded-lg border border-line bg-white p-4 shadow-warm-xs">
            <div class="flex items-center justify-between">
              <h2 class="font-display text-[16px] font-bold text-ink">Cover needed each day</h2>
              <select v-model="savedSetName" class="h-8 rounded-md border border-line bg-white px-2 text-[12.5px]"
                @change="loadSet">
                <option value="">Start from scratch…</option>
                <option v-for="s in constraintSets" :key="s.id" :value="s.name">{{ s.name }}</option>
              </select>
            </div>

            <div class="mt-3 overflow-x-auto">
              <table class="w-full min-w-[560px] text-left text-[13px]">
                <thead>
                  <tr class="border-b border-line text-[10.5px] uppercase tracking-[0.5px] text-muted">
                    <th class="py-2">Day</th>
                    <th v-for="t in templates" :key="t.id" class="px-2 py-2 text-center">
                      {{ t.name }}
                      <span class="block font-normal normal-case text-[10px]">{{ t.start_time.slice(0,5) }}–{{ t.end_time.slice(0,5) }}</span>
                    </th>
                    <th class="px-2 py-2 text-right">Slots</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="d in days" :key="d.key" class="border-b border-line-soft last:border-0">
                    <td class="py-1.5 font-semibold">{{ d.label }}</td>
                    <td v-for="t in templates" :key="t.id" class="px-2 py-1.5 text-center">
                      <input v-model.number="cover[d.key][t.name]" type="number" min="0" max="20"
                        class="h-8 w-14 rounded-md border border-line bg-white text-center text-[13px]">
                    </td>
                    <td class="px-2 py-1.5 text-right tabular-nums text-muted">{{ daySlots(d.key) }}</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-line-soft pt-3">
              <button class="press rounded-md bg-surface-sunken px-2.5 py-1 text-[12px] font-semibold text-brown" @click="fillWeekdays">
                Copy Mon to all weekdays
              </button>
              <button class="press rounded-md bg-surface-sunken px-2.5 py-1 text-[12px] font-semibold text-brown" @click="clearCover">
                Clear
              </button>
              <span class="ml-auto text-[12.5px] text-muted">{{ totalSlots }} slot(s) this week</span>
            </div>
          </div>

          <div class="mt-4 rounded-lg border border-line bg-white p-4 shadow-warm-xs">
            <h2 class="font-display text-[16px] font-bold text-ink">Rules</h2>
            <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <label class="block">
                <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Off days / week</span>
                <input v-model.number="rules.off_days_per_week" type="number" min="0" max="6"
                  class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
              </label>
              <label class="block">
                <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Max consecutive days</span>
                <input v-model.number="rules.max_consecutive_days" type="number" min="1" max="7"
                  class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
              </label>
              <label class="block">
                <span class="mb-1 block text-[11px] font-semibold text-ink-soft">Min rest hours</span>
                <input v-model.number="rules.min_rest_hours_between_shifts" type="number" min="0" max="24"
                  class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
              </label>
              <label class="block">
                <span class="mb-1 block text-[11px] font-semibold text-ink-soft">OT threshold (h/wk)</span>
                <input v-model.number="rules.weekly_ot_threshold_hours" type="number" min="1" max="80"
                  class="h-9 w-full rounded-md border border-line bg-white px-2 text-[13px]">
              </label>
            </div>
            <div class="mt-3 flex flex-wrap gap-4">
              <label class="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
                <input v-model="rules.respect_availability" type="checkbox" class="h-3.5 w-3.5 accent-brown"> Respect availability
              </label>
              <label class="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
                <input v-model="rules.respect_pt_caps" type="checkbox" class="h-3.5 w-3.5 accent-brown"> Respect PT caps
              </label>
              <label class="flex items-center gap-1.5 text-[12.5px] text-ink-soft">
                <input v-model="prefs.fair_weekend_rotation" type="checkbox" class="h-3.5 w-3.5 accent-brown"> Rotate weekends fairly
              </label>
            </div>
            <p class="mt-2 text-[11.5px] text-muted">Approved and pending leave is always treated as a hard limit.</p>
          </div>

          <div class="mt-4 flex flex-wrap items-center gap-3">
            <UiButton :loading="generating" :disabled="!totalSlots" @click="generate">Generate proposal</UiButton>
            <UiButton v-if="proposal" variant="secondary" :loading="applying" @click="apply">
              Create draft roster ({{ proposal.summary.filled }} shifts)
            </UiButton>
            <input v-model="saveAsName" placeholder="Save these constraints as…"
              class="h-9 w-56 rounded-md border border-line bg-white px-2.5 text-[13px]">
            <UiButton v-if="saveAsName" variant="ghost" size="sm" :loading="savingSet" @click="saveSet">Save</UiButton>
          </div>
          <p v-if="error" class="mt-2 text-[13px] text-danger">{{ error }}</p>
          <p v-if="message" class="mt-2 text-[13px] text-success">{{ message }}</p>
        </div>

        <!-- Result panel -->
        <div>
          <div v-if="!proposal" class="rounded-lg border border-line-soft bg-surface-sunken p-4">
            <p class="text-[13px] font-semibold text-ink">How this works</p>
            <ol class="mt-2 list-inside list-decimal space-y-1 text-[12px] leading-relaxed text-muted">
              <li>Say how many people you need on each shift.</li>
              <li>Generate — leave, availability and PT caps are honoured automatically.</li>
              <li>Review the grid and any slots that could not be filled.</li>
              <li>Create the draft, then publish when you're happy.</li>
            </ol>
            <p class="mt-2 text-[11.5px] text-muted">
              Nothing is written until you create the draft, so generate as often as you like.
            </p>
          </div>

          <template v-else>
            <div class="grid grid-cols-2 gap-3">
              <UiStat label="Filled" :value="`${proposal.summary.filled}/${proposal.summary.slots}`"
                :tone="proposal.summary.unfilled ? 'warning' : 'success'" />
              <UiStat label="Total hours" :value="proposal.summary.total_hours" unit="h" />
            </div>

            <div class="mt-4 overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-xs">
              <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Hours per person</p>
              <div v-for="p in proposal.summary.per_staff" :key="p.employee_code"
                class="flex items-center gap-2 border-b border-line-soft px-3.5 py-1.5 last:border-0 text-[12.5px]">
                <span class="flex-1">{{ p.display_name }}</span>
                <span class="text-muted">{{ p.days }}d</span>
                <span class="w-12 text-right font-semibold tabular-nums">{{ p.hours }}h</span>
              </div>
            </div>

            <div v-if="proposal.unmet.length" class="mt-4 rounded-lg border border-warning/30 bg-warning-soft p-3.5">
              <p class="text-[12.5px] font-semibold text-warning">{{ proposal.unmet.length }} slot(s) could not be filled</p>
              <div v-for="(u, i) in proposal.unmet.slice(0, 4)" :key="i" class="mt-1.5 text-[12px] text-ink-soft">
                <p class="font-semibold">{{ u.work_date }} · {{ u.block }}</p>
                <p class="text-[11.5px] text-muted">{{ u.rejected.slice(0, 3).join('; ') }}</p>
              </div>
              <p class="mt-1.5 text-[11.5px] text-warning">
                These name the constraint to relax — or leave them as open shifts for the PT pool.
              </p>
            </div>

            <div v-if="proposal.warnings.length" class="mt-3 rounded-lg border border-line bg-surface-sunken p-3">
              <p class="text-[11.5px] font-semibold text-ink-soft">Warnings</p>
              <ul class="mt-1 space-y-0.5 text-[11.5px] text-muted">
                <li v-for="(w, i) in proposal.warnings" :key="i">{{ w }}</li>
              </ul>
            </div>
          </template>
        </div>
      </div>

      <!-- Proposal grid -->
      <div v-if="proposal" class="mt-5">
        <h2 class="mb-2 font-display text-[16px] font-bold text-ink">Proposed week</h2>
        <div class="overflow-x-auto rounded-lg border border-line-soft bg-white shadow-warm-sm">
          <table class="w-full min-w-[760px] text-left text-[12.5px]">
            <thead>
              <tr class="border-b border-line bg-surface-sunken/60 text-[10.5px] uppercase tracking-[0.5px] text-muted">
                <th v-for="h in proposal.grid.header" :key="h" class="px-2.5 py-2 first:pl-3.5">{{ h }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in proposal.grid.rows" :key="i" class="border-b border-line-soft last:border-0">
                <td v-for="(c, ci) in r" :key="ci" class="px-2.5 py-1.5 first:pl-3.5 tabular-nums"
                  :class="c === 'OFF' ? 'text-line-strong' : ci < 2 ? 'font-semibold' : ''">{{ c }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- ════════ IMPORT ════════ -->
    <template v-if="tab === 'import'">
      <!-- Step 1: paste -->
      <div v-if="!preview" class="grid gap-5 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <div class="rounded-lg border border-line bg-white p-4 shadow-warm-xs">
            <h2 class="font-display text-[16px] font-bold text-ink">Paste your roster sheet</h2>
            <p class="mt-1 text-[12.5px] text-muted">
              Select the cells in Google Sheets or Excel and paste here — including the header row. CSV works too.
            </p>
            <textarea v-model="sheetText" rows="12" spellcheck="false"
              class="mt-3 w-full rounded-md border border-line bg-white p-3 font-mono text-[11.5px]"
              placeholder="Staff	Mon 17/08	Tue 18/08	Wed 19/08&#10;Chloe Tan	Opening	Closing	OFF" />
            <div class="mt-3 flex flex-wrap items-center gap-3">
              <select v-model="useMappingName" class="h-9 rounded-md border border-line bg-white px-2 text-[13px]">
                <option value="">Guess the columns</option>
                <option v-for="m in savedMappings" :key="m.id" :value="m.name">Use "{{ m.name }}"</option>
              </select>
              <UiButton :loading="previewing" :disabled="!sheetText.trim()" @click="runPreview">Continue</UiButton>
            </div>
          </div>
        </div>
        <div>
          <div class="rounded-lg border border-line-soft bg-surface-sunken p-4">
            <p class="text-[13px] font-semibold text-ink">Either layout works</p>
            <p class="mt-1.5 text-[12px] font-semibold text-ink-soft">Staff × day grid</p>
            <pre class="mt-1 overflow-x-auto rounded bg-white p-2 text-[10.5px] leading-relaxed">Staff     Mon 17/08  Tue 18/08
Chloe     Opening    Closing
Dylan     OFF        Opening</pre>
            <p class="mt-2 text-[12px] font-semibold text-ink-soft">One row per shift</p>
            <pre class="mt-1 overflow-x-auto rounded bg-white p-2 text-[10.5px] leading-relaxed">Date,Staff,Shift
17/08/2026,Chloe Tan,Opening
17/08/2026,Dylan Ng,12:00-21:00</pre>
            <p class="mt-2 text-[11.5px] text-muted">
              Shift names are matched to your templates. OFF, RD, X and blanks are treated as days off.
            </p>
          </div>
        </div>
      </div>

      <!-- Step 2: confirm the mapping -->
      <div v-else>
        <div class="mb-4 flex flex-wrap items-center gap-3">
          <UiBadge :tone="preview.ready ? 'success' : 'warning'">
            {{ preview.layout === 'grid' ? 'Staff × day grid' : 'One row per shift' }}
          </UiBadge>
          <p class="text-[12.5px] text-muted">
            Header row {{ preview.header_row }} · {{ preview.stats?.rows_read || 0 }} rows read ·
            {{ preview.stats?.shifts_found || 0 }} shift(s) found
            <span v-if="preview.stats?.off_cells"> · {{ preview.stats.off_cells }} day(s) off</span>
          </p>
          <button class="press ml-auto text-[12.5px] font-semibold text-brown" @click="resetImport">Start over</button>
        </div>

        <div class="grid gap-5 lg:grid-cols-3">
          <div class="lg:col-span-2">
            <h2 class="mb-2 font-display text-[16px] font-bold text-ink">Which column is which?</h2>
            <UiTable :columns="[
              { key: 'col', label: 'Your column' },
              { key: 'sample', label: 'First value' },
              { key: 'field', label: 'Import as' },
              { key: 'conf', label: '', align: 'center', width: '50px' },
            ]">
              <tr v-for="c in preview.columns" :key="c.header" class="border-b border-line-soft last:border-0">
                <td class="px-3.5 py-2">
                  <code class="rounded bg-surface-sunken px-1.5 py-0.5 text-[12px]">{{ c.header }}</code>
                </td>
                <td class="max-w-[140px] truncate px-3.5 py-2 text-[12px] text-muted">{{ sampleFor(c.header) }}</td>
                <td class="px-3.5 py-2">
                  <span v-if="c.is_date_column" class="text-[12px] italic text-muted">date column — its cells become shifts</span>
                  <select v-else v-model="columnField[c.header]"
                    class="h-8 w-full rounded-md border bg-white px-2 text-[12.5px]"
                    :class="columnField[c.header] ? 'border-success/40' : 'border-line'">
                    <option value="">— Skip —</option>
                    <optgroup v-for="g in fieldGroups" :key="g" :label="g">
                      <option v-for="f in fields.filter((x) => x.group === g)" :key="f.key" :value="f.key"
                        :disabled="usedFields.includes(f.key) && columnField[c.header] !== f.key">
                        {{ f.label }}
                      </option>
                    </optgroup>
                  </select>
                </td>
                <td class="px-2 py-2 text-center">
                  <span v-if="c.confidence >= 0.9" class="text-[13px] text-success" :title="c.why || ''">✓</span>
                  <span v-else-if="c.confidence > 0" class="text-[13px] text-warning" :title="c.why || 'Partial match — check this'">~</span>
                  <span v-else class="text-[13px] text-line-strong">·</span>
                </td>
              </tr>
            </UiTable>

            <div class="mt-3 flex flex-wrap items-center gap-3">
              <UiButton size="sm" variant="secondary" :loading="previewing" @click="rePreview">Re-check with this mapping</UiButton>
              <UiButton size="sm" :loading="committing" :disabled="!preview.ready" @click="commit">
                Import {{ preview.stats?.shifts_found || 0 }} shift(s)
              </UiButton>
              <input v-model="saveMappingAs" placeholder="Remember this mapping as…"
                class="h-9 w-52 rounded-md border border-line bg-white px-2.5 text-[13px]">
            </div>
            <p v-if="error" class="mt-2 text-[13px] text-danger">{{ error }}</p>
            <p v-if="message" class="mt-2 text-[13px] text-success">{{ message }}</p>
          </div>

          <div>
            <div v-if="preview.mapping_errors?.length" class="mb-3 rounded-lg border border-danger/30 bg-danger-soft p-3">
              <p class="text-[12.5px] font-semibold text-danger">Mapping incomplete</p>
              <ul class="mt-1 space-y-0.5 text-[11.5px] text-ink-soft">
                <li v-for="(e, i) in preview.mapping_errors" :key="i">{{ e }}</li>
              </ul>
            </div>

            <div v-if="preview.sample?.length" class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-xs">
              <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">
                Preview ({{ preview.stats.shifts_found }} shifts)
              </p>
              <div v-for="(s, i) in preview.sample" :key="i"
                class="flex items-center gap-2 border-b border-line-soft px-3.5 py-1.5 last:border-0 text-[12px]">
                <span class="w-[68px] tabular-nums text-muted">{{ s.work_date.slice(5) }}</span>
                <span class="flex-1 truncate font-semibold">{{ s.display_name }}</span>
                <span class="tabular-nums">{{ s.start }}–{{ s.end }}</span>
              </div>
            </div>

            <div v-if="preview.errors?.length" class="mt-3 rounded-lg border border-warning/30 bg-warning-soft p-3">
              <p class="text-[12.5px] font-semibold text-warning">{{ preview.errors.length }} row(s) will be skipped</p>
              <ul class="mt-1 space-y-0.5 text-[11.5px] text-ink-soft">
                <li v-for="(e, i) in preview.errors.slice(0, 6)" :key="i">Row {{ e.row }}: {{ e.error }}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </template>

    <!-- ════════ EXPORT ════════ -->
    <template v-if="tab === 'export'">
      <div class="grid gap-5 lg:grid-cols-3">
        <div class="lg:col-span-2">
          <div class="rounded-lg border border-line bg-white p-4 shadow-warm-xs">
            <h2 class="font-display text-[16px] font-bold text-ink">Send this week's roster somewhere</h2>
            <p class="mt-1 text-[12.5px] text-muted">
              {{ currentRoster ? `${currentRoster.status} roster for week of ${currentRoster.week_start}` : 'No roster for the selected store and week.' }}
            </p>
            <div v-if="currentRoster" class="mt-3 flex flex-wrap gap-2">
              <button v-for="f in exportFormats" :key="f.key"
                class="press rounded-md border border-line bg-white px-3 py-1.5 text-[12.5px] font-semibold text-brown"
                :class="exportFormat === f.key ? 'border-yellow-deep bg-yellow-soft' : ''"
                @click="runExport(f.key)">
                {{ f.label }}
              </button>
            </div>
            <div v-if="exportOut" class="mt-3">
              <div class="flex items-center gap-2">
                <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">{{ exportOut.label }}</p>
                <button class="press ml-auto rounded-full bg-yellow-soft px-3 py-1 text-[11px] font-semibold text-brown"
                  @click="copyExport">{{ copied ? 'Copied ✓' : 'Copy' }}</button>
              </div>
              <textarea :value="exportOut.text" rows="14" readonly spellcheck="false"
                class="mt-1.5 w-full rounded-md border border-line bg-surface-sunken p-3 font-mono text-[11px]" />
              <p v-if="exportOut.note" class="mt-1.5 text-[11.5px] text-muted">{{ exportOut.note }}</p>
            </div>
          </div>
        </div>
        <div>
          <div class="rounded-lg border border-blue/30 bg-blue-soft p-4">
            <p class="text-[13px] font-semibold text-brown">Which format?</p>
            <ul class="mt-1.5 space-y-1.5 text-[12px] leading-relaxed text-ink-soft">
              <li><strong>Sheets (grid)</strong> — the staff × day view people read at the counter. Paste into a selection.</li>
              <li><strong>Sheets (rows)</strong> — one row per shift, best for pivot tables and re-importing later.</li>
              <li><strong>Airtable</strong> — ready-to-POST records; field names match the column labels.</li>
              <li><strong>CSV</strong> — downloads a file.</li>
            </ul>
            <p class="mt-2 text-[11.5px] text-ink-soft">
              A rows export re-imports cleanly, so an edited sheet can come straight back in.
            </p>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['supervisor-only'] })

const { staff } = useSession()

const tabs = [
  { key: 'generate', label: 'Generate' },
  { key: 'import', label: 'Import a sheet' },
  { key: 'export', label: 'Export' },
]
const tab = ref('generate')

const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)
function mondayOf(date: string) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
  return d.toISOString().slice(0, 10)
}
function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

const weekStart = ref(addDays(mondayOf(today), 7))
const storeId = ref(staff.value?.home_store_id || '')
const error = ref('')
const message = ref('')

const { data: storesRes } = await useFetch<any>('/api/v1/stores')
const stores = computed<any[]>(() => (storesRes.value?.data || []).filter((s: any) => s.kind === 'store'))
if (!storeId.value && stores.value.length) storeId.value = stores.value[0].id

const { data: templatesRes } = await useFetch<any>('/api/v1/templates')
const templates = computed<any[]>(() => templatesRes.value?.data || [])

const { data: setsRes, refresh: refreshSets } = await useFetch<any>('/api/v1/constraint-sets')
const constraintSets = computed<any[]>(() => setsRes.value?.data || [])

// ── generate state ──
const days = [
  { key: 'mon', label: 'Monday' }, { key: 'tue', label: 'Tuesday' }, { key: 'wed', label: 'Wednesday' },
  { key: 'thu', label: 'Thursday' }, { key: 'fri', label: 'Friday' }, { key: 'sat', label: 'Saturday' },
  { key: 'sun', label: 'Sunday' },
]
const cover = reactive<Record<string, Record<string, number>>>(
  Object.fromEntries(days.map((d) => [d.key, {}])),
)
const rules = reactive({
  off_days_per_week: 1,
  max_consecutive_days: 5,
  min_rest_hours_between_shifts: 10,
  weekly_ot_threshold_hours: 44,
  respect_availability: true,
  respect_pt_caps: true,
})
const prefs = reactive({ fair_weekend_rotation: true, prefer_preferred_availability: true, balance_hours: true })

const daySlots = (day: string) => Object.values(cover[day] || {}).reduce((s: number, n: any) => s + (Number(n) || 0), 0)
const totalSlots = computed(() => days.reduce((s, d) => s + daySlots(d.key), 0))

function fillWeekdays() {
  for (const d of days.slice(1, 5)) cover[d.key] = { ...cover.mon }
}
function clearCover() {
  for (const d of days) cover[d.key] = {}
}

function buildConstraints() {
  const coverage = days
    .map((d) => ({
      weekday: d.key,
      blocks: templates.value
        .filter((t) => Number(cover[d.key]?.[t.name]) > 0)
        .map((t) => ({ template: t.name, count: Number(cover[d.key][t.name]) })),
    }))
    .filter((c) => c.blocks.length)
  return { coverage, rules: { ...rules }, preferences: { ...prefs } }
}

const generating = ref(false)
const proposal = ref<any>(null)

async function generate() {
  generating.value = true; error.value = ''; message.value = ''
  try {
    const r: any = await $fetch('/api/v1/roster-intake/generate', {
      method: 'POST',
      body: { store_id: storeId.value, week_start: weekStart.value, constraints: buildConstraints() },
    })
    proposal.value = r.data
  } catch (err: any) {
    error.value = err?.data?.message || err?.data?.statusMessage || 'Could not generate'
  } finally { generating.value = false }
}

const applying = ref(false)
async function apply() {
  applying.value = true; error.value = ''
  try {
    const r: any = await $fetch('/api/v1/roster-intake/apply', {
      method: 'POST', body: { run_id: proposal.value.run_id },
    })
    message.value = r.data.note
  } catch (err: any) {
    error.value = err?.data?.message || err?.data?.statusMessage || 'Could not create the draft'
  } finally { applying.value = false }
}

const savedSetName = ref('')
const saveAsName = ref('')
const savingSet = ref(false)

function loadSet() {
  const set = constraintSets.value.find((s) => s.name === savedSetName.value)
  if (!set) return
  clearCover()
  for (const day of set.constraints?.coverage || []) {
    for (const b of day.blocks || []) {
      if (b.template) cover[day.weekday][b.template] = b.count
    }
  }
  Object.assign(rules, set.constraints?.rules || {})
  Object.assign(prefs, set.constraints?.preferences || {})
}

async function saveSet() {
  savingSet.value = true; error.value = ''
  try {
    await $fetch('/api/v1/constraint-sets', {
      method: 'POST',
      body: { name: saveAsName.value, store_id: storeId.value, constraints: buildConstraints() },
    })
    message.value = `Saved "${saveAsName.value}".`
    saveAsName.value = ''
    await refreshSets()
  } catch (err: any) {
    error.value = err?.data?.message || err?.data?.statusMessage || 'Could not save'
  } finally { savingSet.value = false }
}

// ── import state ──
const sheetText = ref('')
const preview = ref<any>(null)
const previewing = ref(false)
const committing = ref(false)
const useMappingName = ref('')
const saveMappingAs = ref('')
const columnField = reactive<Record<string, string>>({})

const { data: mappingsRes, refresh: refreshMappings } = await useFetch<any>('/api/v1/roster-intake/mappings')
const savedMappings = computed<any[]>(() => mappingsRes.value?.data || [])
const fields = computed<any[]>(() => mappingsRes.value?.fields || [])
const fieldGroups = computed(() => [...new Set(fields.value.map((f) => f.group))])
const usedFields = computed(() => Object.values(columnField).filter(Boolean))

function syncColumnField() {
  for (const k of Object.keys(columnField)) delete columnField[k]
  for (const c of preview.value?.columns || []) {
    if (!c.is_date_column) columnField[c.header] = c.field || ''
  }
}

function sampleFor(header: string) {
  const line = sheetText.value.split(/\r?\n/)[(preview.value?.header_row || 1)]
  if (!line) return '—'
  const delim = line.includes('\t') ? '\t' : ','
  const idx = (preview.value?.headers || []).indexOf(header)
  return line.split(delim)[idx]?.trim() || '—'
}

async function doPreview(mapping?: Record<string, string>) {
  previewing.value = true; error.value = ''; message.value = ''
  try {
    const r: any = await $fetch('/api/v1/roster-intake/import', {
      method: 'POST',
      body: {
        step: 'preview',
        text: sheetText.value,
        store_id: storeId.value,
        week_start: weekStart.value,
        mapping: mapping || undefined,
        layout: mapping ? preview.value?.layout : undefined,
        mapping_id: !mapping && useMappingName.value
          ? savedMappings.value.find((m) => m.name === useMappingName.value)?.id
          : undefined,
      },
    })
    preview.value = r.data
    if (!mapping) syncColumnField()
  } catch (err: any) {
    error.value = err?.data?.message || err?.data?.statusMessage || 'Could not read that sheet'
  } finally { previewing.value = false }
}

const runPreview = () => doPreview()

function rePreview() {
  const mapping: Record<string, string> = {}
  for (const [header, field] of Object.entries(columnField)) {
    if (field) mapping[field] = header
  }
  doPreview(mapping)
}

async function commit() {
  committing.value = true; error.value = ''
  try {
    const r: any = await $fetch('/api/v1/roster-intake/import', {
      method: 'POST',
      body: { step: 'commit', batch_id: preview.value.batch_id, save_mapping_as: saveMappingAs.value || undefined },
    })
    message.value = r.data.note
    preview.value = null
    sheetText.value = ''
    await refreshMappings()
  } catch (err: any) {
    error.value = err?.data?.message || err?.data?.statusMessage || 'Could not import'
  } finally { committing.value = false }
}

function resetImport() {
  preview.value = null
  error.value = ''
  message.value = ''
}

// ── export state ──
const exportFormats = [
  { key: 'grid_tsv', label: 'Sheets (grid)' },
  { key: 'tsv', label: 'Sheets (rows)' },
  { key: 'airtable', label: 'Airtable' },
  { key: 'csv', label: 'CSV' },
  { key: 'markdown', label: 'Markdown' },
]
const exportFormat = ref('')
const exportOut = ref<any>(null)
const copied = ref(false)

const { data: rosterRes } = await useFetch<any>('/api/v1/rosters', {
  query: computed(() => ({ store_id: storeId.value, week_start: weekStart.value })),
  watch: [storeId, weekStart],
})
const currentRoster = computed<any>(() => rosterRes.value?.data)

async function runExport(format: string) {
  exportFormat.value = format
  exportOut.value = null
  error.value = ''
  try {
    const r: any = await $fetch(`/api/v1/rosters/${currentRoster.value.id}/export`, {
      query: { format, download: 'false' },
    })
    const d = r.data
    exportOut.value = {
      label: exportFormats.find((f) => f.key === format)?.label || format,
      text: d.records ? JSON.stringify({ records: d.records.slice(0, 10) }, null, 2) : (d.data || JSON.stringify(d.rows, null, 2)),
      note: d.note,
    }
  } catch (err: any) {
    error.value = err?.data?.message || err?.data?.statusMessage || 'Could not export'
  }
}

async function copyExport() {
  try {
    await navigator.clipboard.writeText(exportOut.value.text)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch { /* selectable anyway */ }
}
</script>
