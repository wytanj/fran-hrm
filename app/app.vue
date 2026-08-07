<template>
  <!-- Pages await their data in setup, so a navigation can sit for a moment
       before anything renders. The progress bar is the acknowledgement that
       the click landed. -->
  <NuxtLoadingIndicator color="#F0C820" :height="3" :throttle="80" :duration="2500" />
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<script setup lang="ts">
import '~/assets/css/main.css'
</script>
