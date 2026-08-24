<template>
  <div class="flex flex-wrap items-center gap-2">
    <div class="w-[210px] shrink-0">
      <UiSegmented :items="modeItems" :model-value="mode" @update:model-value="mode = $event" />
    </div>
    <div class="flex items-center gap-1 rounded-md border border-line bg-white">
      <button
        class="press h-9 w-8 text-brown disabled:opacity-40"
        :disabled="pending || !canGoPrev"
        :aria-label="`Previous ${mode}`"
        @click="$emit('prev')"
      >‹</button>
      <span class="flex min-w-[128px] items-center justify-center gap-1.5 px-1 text-center text-[12.5px] font-semibold tabular-nums">
        <UiSpinner v-if="pending" size="xs" />
        {{ label }}
      </span>
      <button
        class="press h-9 w-8 text-brown disabled:opacity-40"
        :disabled="pending || !canGoNext"
        :aria-label="`Next ${mode}`"
        @click="$emit('next')"
      >›</button>
    </div>
    <button
      v-if="showToday"
      class="press h-9 rounded-md border border-line bg-white px-3 text-[12.5px] font-semibold text-brown"
      @click="$emit('today')"
    >
      Today
    </button>
  </div>
</template>

<script setup lang="ts">
const mode = defineModel<string>('mode', { required: true })

defineProps<{
  label: string
  canGoPrev: boolean
  canGoNext: boolean
  showToday?: boolean
  pending?: boolean
}>()

defineEmits<{
  prev: []
  next: []
  today: []
}>()

const modeItems = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' },
]
</script>
