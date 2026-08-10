<template>
  <div>
    <UiPageHeader eyebrow="Time & attendance" title="Check-in scanner"
      subtitle="Point the camera at a staff member's check-in QR to clock them in or out. Their code refreshes every minute — you're the proof they're really here." />

    <div class="grid gap-5 lg:grid-cols-3">
      <!-- Scanner -->
      <div class="lg:col-span-2">
        <div class="rounded-lg border border-line bg-white p-4 shadow-warm-xs">
          <div class="mb-3 flex flex-wrap items-center gap-3">
            <select v-if="stores.length > 1" v-model="storeId" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px] font-medium">
              <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <div class="flex rounded-md border border-line bg-white p-0.5">
              <button v-for="a in actions" :key="a.key" type="button"
                class="press rounded px-2.5 py-1 text-[12.5px] font-semibold"
                :class="action === a.key ? 'bg-yellow-soft text-brown' : 'text-muted hover:text-ink'"
                @click="action = a.key">{{ a.label }}</button>
            </div>
            <UiButton size="sm" :variant="scanning ? 'secondary' : 'primary'" @click="scanning ? stop() : start()">
              {{ scanning ? 'Stop camera' : 'Start camera' }}
            </UiButton>
          </div>

          <div class="relative mx-auto aspect-[4/3] w-full max-w-[520px] overflow-hidden rounded-lg bg-ink/90">
            <video ref="video" class="h-full w-full object-cover" playsinline muted autoplay></video>
            <div v-if="!scanning" class="absolute inset-0 flex items-center justify-center text-center text-[13px] text-white/70">
              Camera is off
            </div>
            <div v-if="scanning" class="pointer-events-none absolute inset-[15%] rounded-lg border-2 border-yellow-deep/80"></div>
          </div>

          <p v-if="camError" class="mt-2 text-[12.5px] text-danger">{{ camError }}</p>

          <!-- Fallback when the device has no barcode detector -->
          <div v-if="!detectorSupported" class="mt-3 rounded-md border border-line-soft bg-surface-sunken p-3">
            <p class="text-[12px] font-semibold text-ink-soft">This device can't scan in-browser.</p>
            <p class="mt-0.5 text-[11.5px] text-muted">Use an Android/Chrome tablet, or paste the staff code shown under their QR.</p>
            <div class="mt-2 flex gap-2">
              <input v-model="manualToken" placeholder="hrmstaff.…"
                class="h-9 flex-1 rounded-md border border-line bg-white px-2.5 font-mono text-[12px]">
              <UiButton size="sm" :loading="posting" @click="submit(manualToken)">Clock</UiButton>
            </div>
          </div>
        </div>
      </div>

      <!-- Live feed -->
      <div>
        <div class="overflow-hidden rounded-lg border border-line bg-white shadow-warm-xs">
          <p class="border-b border-line-soft px-3.5 py-2 text-[11px] font-semibold uppercase tracking-[0.5px] text-muted">
            Scanned this session
          </p>
          <div v-if="!feed.length" class="px-3.5 py-6 text-center text-[12.5px] text-muted">
            Nobody scanned yet. Start the camera and point it at a staff QR.
          </div>
          <div v-for="(f, i) in feed" :key="i"
            class="flex items-center gap-2 border-b border-line-soft px-3.5 py-2 last:border-0 text-[12.5px]">
            <span class="text-[15px]">{{ f.ok ? '✓' : '⚠' }}</span>
            <div class="min-w-0 flex-1">
              <p class="truncate font-semibold" :class="f.ok ? 'text-ink' : 'text-danger'">{{ f.name }}</p>
              <p class="text-[11px] text-muted">
                {{ f.label }} · {{ f.at }}<span v-if="f.flags?.length" class="text-warning"> · {{ f.flags.join(', ') }}</span>
              </p>
            </div>
          </div>
        </div>
        <p class="mt-3 text-[11.5px] text-muted">
          Staff open <strong>Clock → Show my check-in QR</strong> on their phone. Each code is good for one minute; you scanning it is what confirms they're at the counter.
        </p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['supervisor-only'] })

const { staff } = useSession()

const { data: storesRes } = await useFetch<any>('/api/v1/stores')
const stores = computed<any[]>(() => (storesRes.value?.data || []).filter((s: any) => s.kind === 'store'))
const storeId = ref(staff.value?.home_store_id || '')
if (!storeId.value && stores.value.length) storeId.value = stores.value[0].id

const actions = [
  { key: 'clock_in', label: 'Clock in' },
  { key: 'clock_out', label: 'Clock out' },
  { key: 'break_start', label: 'Break' },
  { key: 'break_end', label: 'End break' },
]
const action = ref('clock_in')

const video = ref<HTMLVideoElement | null>(null)
const scanning = ref(false)
const camError = ref('')
const posting = ref(false)
const manualToken = ref('')
const detectorSupported = ref(true)
const feed = ref<any[]>([])

let stream: MediaStream | null = null
let detector: any = null
let loopTimer: any = null
const recent = new Map<string, number>() // token → last-posted ms, to debounce a QR held in frame

onMounted(() => {
  detectorSupported.value = typeof window !== 'undefined' && 'BarcodeDetector' in window
})

async function start() {
  camError.value = ''
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
    if (video.value) { video.value.srcObject = stream; await video.value.play() }
    scanning.value = true
    if (detectorSupported.value) {
      detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] })
      loop()
    }
  } catch (err: any) {
    camError.value = err?.message || 'Could not open the camera. Grant permission and try again.'
    stop()
  }
}

function stop() {
  scanning.value = false
  if (loopTimer) { clearTimeout(loopTimer); loopTimer = null }
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null }
  if (video.value) video.value.srcObject = null
}

async function loop() {
  if (!scanning.value || !detector || !video.value) return
  try {
    const codes = await detector.detect(video.value)
    if (codes?.length) await submit(codes[0].rawValue)
  } catch { /* frame not ready — try again */ }
  loopTimer = setTimeout(loop, 300)
}

async function submit(token: string) {
  const t = String(token || '').trim()
  if (!t) return
  const last = recent.get(t)
  if (last && Date.now() - last < 6000) return // same QR still in frame
  recent.set(t, Date.now())

  posting.value = true
  try {
    const res: any = await $fetch('/api/v1/clock', {
      method: 'POST',
      body: { action: action.value, staff_qr_token: t, store_id: storeId.value },
    })
    feed.value.unshift({
      ok: true,
      name: res.staff ? `${res.staff.display_name}` : 'Staff member',
      label: actions.find((a) => a.key === res.action)?.label || res.action,
      at: new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' }),
      flags: res.flags || [],
    })
    manualToken.value = ''
  } catch (err: any) {
    feed.value.unshift({
      ok: false,
      name: err?.data?.message || err?.data?.statusMessage || 'Could not clock',
      label: actions.find((a) => a.key === action.value)?.label,
      at: new Date().toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Singapore' }),
    })
  } finally { posting.value = false }
}

onBeforeUnmount(stop)
</script>
