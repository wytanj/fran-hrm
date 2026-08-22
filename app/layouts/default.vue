<template>
  <div class="min-h-screen bg-cream">
    <AppSidebar v-if="staff" :open="drawerOpen" @close="drawerOpen = false" />

    <div :class="staff ? 'lg:pl-[248px]' : ''">
      <div v-if="viewingAs" class="no-print sticky top-0 z-30 flex items-center gap-2 bg-brown px-4 py-2 text-[12.5px] font-semibold text-cream sm:px-6">
        <span>👀 Viewing as <strong>{{ staff?.display_name }}</strong> — a dummy staff member. Nothing you do here is real.</span>
        <button class="press ml-auto rounded-full bg-yellow px-3 py-1 text-[11.5px] font-semibold text-brown" @click="exitViewAs">
          Exit view
        </button>
      </div>

      <!-- Topbar: mobile menu button, store/date context, quick clock action -->
      <header v-if="staff" class="no-print sticky z-20 flex h-14 items-center gap-3 border-b border-line bg-cream/95 px-4 backdrop-blur sm:px-6"
        :class="viewingAs ? 'top-[37px]' : 'top-0'">
        <button class="press text-[18px] text-brown lg:hidden" aria-label="Open menu" @click="drawerOpen = true">☰</button>
        <div class="min-w-0 flex-1">
          <p class="truncate text-[12px] text-muted">
            {{ todayLabel }}<span v-if="staff.home_store"> · {{ staff.home_store.name }}</span>
          </p>
        </div>
        <NuxtLink to="/help" class="press hidden text-[12px] font-semibold text-muted hover:text-brown sm:block">Help</NuxtLink>
        <NuxtLink to="/clock" class="press rounded-full bg-yellow px-3.5 py-1.5 text-[12px] font-semibold text-brown shadow-glow">
          Clock
        </NuxtLink>
      </header>

      <main class="mx-auto w-full max-w-[1400px] px-4 py-6 sm:px-6 lg:px-8">
        <slot />
      </main>
    </div>
  </div>
</template>

<script setup lang="ts">
const { staff, viewingAs, exitViewAs } = useSession()
const drawerOpen = ref(false)
const route = useRoute()

watch(() => route.fullPath, () => { drawerOpen.value = false })

const todayLabel = new Date().toLocaleDateString('en-SG', {
  weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Singapore',
})
</script>
