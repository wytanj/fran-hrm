<template>
  <div>
    <UiPageHeader eyebrow="People" title="HRM schema in force"
      subtitle="The people record Fran is running: fields, citizenship, titles, hierarchy, permissions. Git authors it; this page is the published copy.">
      <template #actions>
        <UiButton v-if="canPublish" size="sm" variant="secondary" :loading="snapping" @click="snapshot(false)">
          Snapshot current
        </UiButton>
        <UiButton v-if="canPublish && drift?.drifted" size="sm" :loading="snapping" @click="snapshot(true)">
          Snapshot & publish
        </UiButton>
      </template>
    </UiPageHeader>

    <UiBusy :busy="pending" label="Loading the in-force schema…">
    <div v-if="err" class="rounded-lg border border-danger/30 bg-danger-soft p-4 text-[13px] text-danger">{{ err }}</div>
    <template v-else-if="inForce">
      <div class="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <UiStat label="In force" :value="`v${inForce.version}`" />
        <UiStat label="Git" :value="shortSha" :hint="inForce.git_dirty ? 'working tree was dirty' : (inForce.git_describe || '')" />
        <UiStat label="Published" :value="publishedWhen" :hint="inForce.published_by ? 'by an HQ admin' : 'bootstrapped'" />
        <UiStat label="Hash" :value="inForce.content_hash.slice(0, 10)" hint="sha256 of the document" />
      </div>

      <div v-if="drift?.drifted" class="mb-4 rounded-lg border border-warning/40 bg-warning-soft p-3.5">
        <p class="text-[13px] font-semibold text-warning">
          {{ drift.core_changed ? 'The git catalogs have moved on from this version.' : 'This workspace’s overlay (custom fields, functions, leave types) has changed.' }}
        </p>
        <p class="mt-1 text-[12px] leading-relaxed text-ink-soft">
          What HQ published stays in force until someone publishes a new snapshot — that is the point.
          <template v-if="canPublish"> Snapshot & publish to put the current catalogs live.</template>
        </p>
      </div>

      <div class="mb-4 flex gap-1 rounded-md border border-line bg-white p-0.5 w-fit">
        <button v-for="t in tabs" :key="t.key" type="button"
          class="press rounded px-2.5 py-1 text-[12.5px] font-semibold"
          :class="tab === t.key ? 'bg-yellow-soft text-brown' : 'text-muted'"
          @click="tab = t.key">
          {{ t.label }}
        </button>
      </div>

      <section v-if="tab === 'text'" class="rounded-lg border border-line-soft bg-white shadow-warm-sm">
        <div class="flex items-center justify-between border-b border-line-soft px-3.5 py-2">
          <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">Verbose text</p>
          <button class="press text-[12px] font-semibold text-brown" @click="copy(inForce.text, 'text')">
            {{ copied === 'text' ? 'Copied ✓' : 'Copy' }}
          </button>
        </div>
        <pre class="max-h-[70vh] overflow-auto whitespace-pre-wrap px-4 py-3 font-mono text-[12px] leading-relaxed text-ink">{{ inForce.text }}</pre>
      </section>

      <section v-else-if="tab === 'json'" class="rounded-lg border border-line-soft bg-white shadow-warm-sm">
        <div class="flex items-center justify-between border-b border-line-soft px-3.5 py-2">
          <p class="text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">JSON</p>
          <button class="press text-[12px] font-semibold text-brown" @click="copy(jsonText, 'json')">
            {{ copied === 'json' ? 'Copied ✓' : 'Copy' }}
          </button>
        </div>
        <pre class="max-h-[70vh] overflow-auto px-4 py-3 font-mono text-[11.5px] leading-relaxed text-ink">{{ jsonText }}</pre>
      </section>

      <section v-else>
        <UiTable :columns="[
          { key: 'v', label: 'Ver', width: '70px' },
          { key: 'git', label: 'Git' },
          { key: 'hash', label: 'Hash' },
          { key: 'when', label: 'Created' },
          { key: 'force', label: 'In force', align: 'center', width: '100px' },
          { key: 'act', label: '', align: 'right', width: '110px' },
        ]">
          <tr v-for="v in versions" :key="v.id" class="border-b border-line-soft last:border-0"
            :class="v.in_force ? 'bg-yellow-soft/40' : ''">
            <td class="px-3.5 py-2.5 font-semibold tabular-nums text-ink">v{{ v.version }}</td>
            <td class="px-3.5 py-2.5 font-mono text-[12px] text-muted">
              {{ (v.git_describe || v.git_sha || '—').slice(0, 16) }}{{ v.git_dirty ? '*' : '' }}
            </td>
            <td class="px-3.5 py-2.5 font-mono text-[11.5px] text-muted">{{ v.content_hash.slice(0, 12) }}</td>
            <td class="px-3.5 py-2.5 text-[12.5px] text-muted">{{ fmt(v.created_at) }}</td>
            <td class="px-3.5 py-2.5 text-center">
              <UiBadge v-if="v.in_force" tone="primary">live</UiBadge>
              <span v-else class="text-muted">—</span>
            </td>
            <td class="px-3.5 py-2.5 text-right">
              <button v-if="canPublish && !v.in_force" class="press text-[12px] font-semibold text-brown"
                :disabled="busy === v.id" @click="publish(v)">
                {{ busy === v.id ? '…' : 'Publish' }}
              </button>
            </td>
          </tr>
          <tr v-if="!versions.length">
            <td colspan="6" class="px-3.5 py-8 text-center text-[13px] text-muted">No versions yet.</td>
          </tr>
        </UiTable>
      </section>

      <p v-if="msg" class="mt-3 text-[12.5px]" :class="msgErr ? 'text-danger' : 'text-success'">{{ msg }}</p>
      <p class="mt-4 max-w-3xl text-[11.5px] leading-relaxed text-muted">
        Core fields and invariants come from git (<code class="font-mono">core/staff/fields.mjs</code>,
        <code class="font-mono">core/hrm-schema/invariants.mjs</code>). Publishing writes an immutable row and
        flips <code class="font-mono">in_force</code> in one transaction — Fran cannot have two people policies at once.
      </p>
    </template>
    </UiBusy>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['hq-admin-only'] })

const tabs = [
  { key: 'text', label: 'Verbose text' },
  { key: 'json', label: 'JSON' },
  { key: 'versions', label: 'Versions' },
]
const tab = ref('text')

const { data: res, pending, error: fetchErr, refresh } = await useFetch<any>('/api/v1/hrm-schema')
const { data: verRes, refresh: refreshVersions } = await useFetch<any>('/api/v1/hrm-schema/versions', { lazy: true })

const inForce = computed(() => res.value?.data?.in_force || null)
const drift = computed(() => res.value?.data?.drift || null)
const canPublish = computed(() => !!res.value?.data?.can_publish)
const versions = computed<any[]>(() => verRes.value?.data || [])
const err = computed(() => {
  const e: any = fetchErr.value
  return e?.data?.message || e?.data?.statusMessage || (e ? 'Could not load the schema.' : '')
})
const jsonText = computed(() => inForce.value?.schema ? JSON.stringify(inForce.value.schema, null, 2) : '')
const shortSha = computed(() => {
  const v = inForce.value
  if (!v) return '—'
  return (v.git_describe || v.git_sha || '—').slice(0, 12)
})
const publishedWhen = computed(() => fmt(inForce.value?.published_at || inForce.value?.created_at))

const copied = ref('')
const snapping = ref(false)
const busy = ref('')
const msg = ref('')
const msgErr = ref(false)

function fmt(iso?: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-SG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Singapore' })
}

async function copy(text: string, key: string) {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = key
    setTimeout(() => { if (copied.value === key) copied.value = '' }, 1500)
  } catch {
    msg.value = text.slice(0, 80)
  }
}

async function snapshot(publishNow: boolean) {
  snapping.value = true; msg.value = ''; msgErr.value = false
  try {
    const r: any = await $fetch('/api/v1/hrm-schema/snapshot', { method: 'POST', body: { publish: publishNow } })
    msg.value = r.note
    await Promise.all([refresh(), refreshVersions()])
  } catch (e: any) {
    msgErr.value = true
    msg.value = e?.data?.message || e?.data?.statusMessage || 'Snapshot failed'
  } finally { snapping.value = false }
}

async function publish(v: any) {
  if (!confirm(`Put version ${v.version} in force? The current live document will be archived, not deleted.`)) return
  busy.value = v.id; msg.value = ''; msgErr.value = false
  try {
    const r: any = await $fetch('/api/v1/hrm-schema/publish', { method: 'POST', body: { version_id: v.id } })
    msg.value = r.note
    await Promise.all([refresh(), refreshVersions()])
  } catch (e: any) {
    msgErr.value = true
    msg.value = e?.data?.message || e?.data?.statusMessage || 'Publish failed'
  } finally { busy.value = '' }
}
</script>
