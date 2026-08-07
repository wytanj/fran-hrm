<template>
  <div>
    <UiPageHeader eyebrow="Help centre" title="How things work"
      subtitle="The current policy for clocking, rosters, leave, overtime and payroll. Claude reads this same content.">
      <template #actions>
        <input v-model="query" placeholder="Search — e.g. forgot to clock out"
          class="h-9 w-72 rounded-md border border-line bg-white px-3 text-[13px]">
      </template>
    </UiPageHeader>

    <!-- Search results -->
    <template v-if="query.trim().length > 1">
      <h2 class="mb-2 font-display text-[18px] font-bold text-ink">
        {{ matches.length ? `${matches.length} result${matches.length > 1 ? 's' : ''}` : 'No strong match' }}
      </h2>
      <div v-if="matches.length" class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
        <NuxtLink v-for="(m, i) in matches" :key="m.slug" :to="`/help/${m.slug}`"
          class="press block px-4 py-3" :class="i > 0 ? 'border-t border-line-soft' : ''">
          <div class="flex items-baseline gap-2">
            <p class="text-[14px] font-semibold text-ink">{{ m.title }}</p>
            <UiBadge tone="muted">{{ m.category }}</UiBadge>
          </div>
          <p v-if="m.summary" class="mt-0.5 text-[12.5px] text-muted">{{ m.summary }}</p>
          <ol v-if="m.steps_preview?.length" class="mt-1.5 list-inside list-decimal text-[12px] text-ink-soft">
            <li v-for="(s, si) in m.steps_preview.slice(0, 3)" :key="si" class="truncate">{{ stripMd(s) }}</li>
          </ol>
        </NuxtLink>
      </div>
      <div v-else class="rounded-lg border border-line-soft bg-white p-8 text-center shadow-warm-sm">
        <p class="text-[14px] font-semibold text-ink">Nothing matched that</p>
        <p class="mt-1 text-[13px] text-muted">Try different words, or browse the categories below.</p>
      </div>
    </template>

    <!-- Browse -->
    <div class="mt-6 grid gap-5 md:grid-cols-2 xl:grid-cols-3">
      <div v-for="cat in visibleCategories" :key="cat.key">
        <h2 class="mb-2 font-display text-[16px] font-bold text-ink">{{ cat.label }}</h2>
        <div class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-xs">
          <NuxtLink v-for="(a, i) in byCategory[cat.key] || []" :key="a.slug" :to="`/help/${a.slug}`"
            class="press flex items-start gap-2.5 px-3.5 py-2.5" :class="i > 0 ? 'border-t border-line-soft' : ''">
            <div class="min-w-0 flex-1">
              <p class="text-[13px] font-semibold text-ink">{{ a.title }}</p>
              <p v-if="a.summary" class="mt-0.5 text-[11.5px] leading-relaxed text-muted">{{ a.summary }}</p>
            </div>
            <span class="mt-0.5 shrink-0 text-line-strong">›</span>
          </NuxtLink>
        </div>
      </div>
    </div>

    <div class="mt-6 rounded-lg border border-blue/30 bg-blue-soft p-4">
      <p class="text-[13px] font-semibold text-brown">Ask Claude instead</p>
      <p class="mt-1 max-w-2xl text-[12.5px] leading-relaxed text-ink-soft">
        Connected to Claude, you can ask these questions in plain language — Claude searches this
        same help centre, so you get the current policy rather than a guess.
      </p>
      <NuxtLink to="/help/connect-claude" class="press mt-2 inline-block text-[12.5px] font-semibold text-brown underline decoration-brown/30">
        How to connect →
      </NuxtLink>
    </div>
  </div>
</template>

<script setup lang="ts">
const query = ref('')

const { data: listRes } = await useFetch<any>('/api/v1/help')
const articles = computed<any[]>(() => listRes.value?.data || [])

const { data: searchRes } = await useFetch<any>('/api/v1/help', {
  query: computed(() => ({ q: query.value.trim().length > 1 ? query.value : undefined })),
  watch: [query], server: false,
})
const matches = computed<any[]>(() => searchRes.value?.data?.matches || [])

const categories = [
  { key: 'attendance', label: 'Clocking & attendance' },
  { key: 'scheduling', label: 'Rosters & shifts' },
  { key: 'leave', label: 'Leave' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'claude', label: 'Claude' },
  { key: 'account', label: 'Your account' },
]

const byCategory = computed(() => {
  const out: Record<string, any[]> = {}
  for (const a of articles.value) (out[a.category] ||= []).push(a)
  return out
})

const visibleCategories = computed(() => categories.filter((c) => byCategory.value[c.key]?.length))

/** Strip the bold markers that appear in step text pulled from markdown. */
function stripMd(s: string) {
  return s.replace(/\*\*/g, '').replace(/`/g, '')
}
</script>
