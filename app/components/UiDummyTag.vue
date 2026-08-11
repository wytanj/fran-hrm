<template>
  <span v-if="show"
    class="ml-1.5 inline-flex items-center rounded-full border border-dashed border-brown/45 bg-peach-soft px-1.5 py-[1px] align-middle text-[9.5px] font-bold uppercase tracking-wide text-brown"
    title="Test/dummy staff — not a real person">Dummy</span>
</template>

<script setup lang="ts">
defineProps<{ show?: boolean }>()
</script>
