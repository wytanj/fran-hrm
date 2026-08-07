<template>
  <li>
    <div class="flex items-start gap-2.5 rounded-lg border bg-white px-3 py-2 shadow-warm-xs"
      :class="node.vacancies && !node.holders.length ? 'border-dashed border-warning/50' : 'border-line-soft'">
      <span class="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold"
        :class="node.is_leadership ? 'bg-yellow text-brown' : 'bg-surface-sunken text-muted'">
        {{ node.code.slice(0, 3) }}
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-baseline gap-x-2">
          <!-- Comms title leads; the formal title is the quiet subtitle. -->
          <p class="text-[13.5px] font-semibold text-ink">{{ node.display_title }}</p>
          <p v-if="node.comms_title" class="text-[11.5px] text-muted">{{ node.title }}</p>
          <UiBadge v-if="node.vacancies" tone="warning">{{ node.vacancies }} vacant</UiBadge>
        </div>
        <p v-if="node.holders.length" class="mt-0.5 text-[12px] text-ink-soft">
          {{ node.holders.map((h) => h.display_name).join(', ') }}
        </p>
        <p v-else class="mt-0.5 text-[12px] italic text-warning">Unfilled seat</p>
        <p v-if="node.purpose" class="mt-0.5 text-[11.5px] leading-relaxed text-muted">{{ node.purpose }}</p>
      </div>
    </div>

    <ul v-if="node.children?.length" class="ml-4 mt-2 space-y-2 border-l border-line pl-4">
      <OrgNode v-for="child in node.children" :key="child.id" :node="child" />
    </ul>
  </li>
</template>

<script setup lang="ts">
// Recursive: a seat renders its children beneath it. Named component so it can
// reference itself in its own template.
defineOptions({ name: 'OrgNode' })
defineProps<{ node: any }>()
</script>
