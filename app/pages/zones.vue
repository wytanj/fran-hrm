<template>
  <div>
    <UiPageHeader eyebrow="Stores" title="Store zones"
      subtitle="Map a store's floor into named zones. Drag on the layout to draw a zone. This structured data feeds scheduling, analytics and (later) vision models.">
      <template #actions>
        <select v-if="stores.length > 1" v-model="storeId" class="h-9 rounded-md border border-line bg-white px-2.5 text-[13px] font-medium">
          <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.name }}</option>
        </select>
      </template>
    </UiPageHeader>

    <div class="grid gap-5 lg:grid-cols-3">
      <!-- Canvas -->
      <div class="lg:col-span-2">
        <div v-if="canEdit && !layoutImg" class="mb-3 rounded-lg border border-dashed border-line bg-white p-4 text-center">
          <p class="text-[13px] font-semibold text-ink">Add the store layout</p>
          <p class="mt-1 text-[12px] text-muted">Upload a floor-plan image (PNG/JPG). Export a PDF plan to an image first.</p>
          <label class="press mt-2 inline-block cursor-pointer rounded-md bg-yellow px-3 py-1.5 text-[12.5px] font-semibold text-brown shadow-glow">
            Upload layout<input type="file" accept="image/*" class="hidden" @change="onUpload">
          </label>
        </div>

        <div class="overflow-hidden rounded-lg border border-line-soft bg-white shadow-warm-sm">
          <div ref="canvas" class="relative select-none bg-surface-sunken"
            :style="{ aspectRatio: aspect || '4 / 3', cursor: canEdit ? 'crosshair' : 'default' }"
            @pointerdown="onDown" @pointermove="onMove" @pointerup="onUp">
            <img v-if="layoutImg" :src="layoutImg" class="pointer-events-none absolute inset-0 h-full w-full object-contain" alt="layout">
            <p v-else-if="!canEdit" class="absolute inset-0 flex items-center justify-center text-[13px] text-muted">No layout uploaded yet.</p>

            <!-- Zones -->
            <div v-for="z in zones" :key="z.id"
              class="absolute flex items-start justify-start rounded-[3px] border-2 p-1 text-[10px] font-bold uppercase tracking-wide"
              :style="zoneStyle(z)" @click.stop="canEdit && (selected = z.id)">
              <span class="rounded bg-white/80 px-1 text-ink">{{ z.name }}</span>
            </div>
            <!-- Drawing rubber-band -->
            <div v-if="draw" class="absolute rounded-[3px] border-2 border-dashed border-brown/70 bg-brown/10" :style="drawStyle" />
          </div>
        </div>
        <p class="mt-2 text-[11.5px] text-muted">
          {{ zones.length }} zone(s). Coordinates are stored as percentages, so the layout renders crisply at any size.
        </p>
      </div>

      <!-- Zone list / edit -->
      <div>
        <div class="rounded-lg border border-line bg-white p-4 shadow-warm-xs">
          <div class="flex items-center justify-between">
            <h2 class="font-display text-[15px] font-bold text-ink">Zones</h2>
            <label v-if="canEdit && layoutImg" class="press cursor-pointer text-[12px] font-semibold text-brown">
              Replace layout<input type="file" accept="image/*" class="hidden" @change="onUpload">
            </label>
          </div>
          <div v-if="!zones.length" class="mt-2 text-[12.5px] text-muted">
            {{ canEdit ? 'Drag on the layout to draw your first zone.' : 'No zones defined yet.' }}
          </div>
          <div v-for="z in zones" :key="z.id" class="mt-2 rounded-md border border-line-soft p-2.5"
            :class="selected === z.id ? 'ring-2 ring-yellow-deep/40' : ''">
            <div class="flex items-center gap-2">
              <span class="h-3.5 w-3.5 shrink-0 rounded-sm" :style="{ background: z.color }" />
              <template v-if="canEdit && selected === z.id">
                <input v-model="z.name" class="h-7 flex-1 rounded border border-line px-1.5 text-[12.5px]" @change="save(z)">
                <input v-model="z.color" type="color" class="h-7 w-7 rounded border border-line" @change="save(z)">
                <button class="press text-[12px] text-danger" @click="remove(z)">✕</button>
              </template>
              <template v-else>
                <span class="flex-1 text-[13px] font-semibold text-ink">{{ z.name }}</span>
                <button v-if="canEdit" class="press text-[12px] font-semibold text-brown" @click="selected = z.id">Edit</button>
              </template>
            </div>
          </div>
        </div>
        <p v-if="error" class="mt-2 text-[12.5px] text-danger">{{ error }}</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ middleware: ['supervisor-only'] })

const { staff } = useSession()
const canEdit = computed(() => ['store_manager', 'area_manager', 'hq_admin'].includes(staff.value?.role || ''))

const { data: storesRes } = await useFetch<any>('/api/v1/stores', { lazy: true, default: () => ({ data: [] }) })
const stores = computed<any[]>(() => (storesRes.value?.data || []).filter((s: any) => s.kind === 'store'))
const storeId = ref('')
watch(stores, (list) => { if (!storeId.value && list.length) storeId.value = list[0].id }, { immediate: true })

const zones = ref<any[]>([])
const layoutImg = ref('')
const aspect = ref('')
const selected = ref('')
const error = ref('')

async function load() {
  if (!storeId.value) return
  const r: any = await $fetch('/api/v1/zones', { query: { store_id: storeId.value } }).catch(() => null)
  zones.value = r?.data?.zones || []
  layoutImg.value = r?.data?.layout?.image_data_url || ''
  aspect.value = r?.data?.layout?.aspect ? `${r.data.layout.aspect} / 1` : ''
}
watch(storeId, load, { immediate: true })

function zoneStyle(z: any) {
  const s = z.shape || {}
  return {
    left: `${s.x}%`, top: `${s.y}%`, width: `${s.w}%`, height: `${s.h}%`,
    borderColor: z.color, background: `${z.color}22`,
  }
}

// ── drawing ──
const canvas = ref<HTMLElement | null>(null)
const draw = ref<any>(null)
const drawStyle = computed(() => draw.value
  ? { left: `${Math.min(draw.value.x, draw.value.x2)}%`, top: `${Math.min(draw.value.y, draw.value.y2)}%`, width: `${Math.abs(draw.value.x2 - draw.value.x)}%`, height: `${Math.abs(draw.value.y2 - draw.value.y)}%` }
  : {})

function pct(e: PointerEvent) {
  const r = canvas.value!.getBoundingClientRect()
  return { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 }
}
function onDown(e: PointerEvent) {
  if (!canEdit.value || !layoutImg.value) return
  const p = pct(e)
  draw.value = { x: p.x, y: p.y, x2: p.x, y2: p.y }
  ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
}
function onMove(e: PointerEvent) {
  if (!draw.value) return
  const p = pct(e); draw.value.x2 = p.x; draw.value.y2 = p.y
}
async function onUp() {
  if (!draw.value) return
  const d = draw.value; draw.value = null
  const shape = { type: 'rect', x: Math.min(d.x, d.x2), y: Math.min(d.y, d.y2), w: Math.abs(d.x2 - d.x), h: Math.abs(d.y2 - d.y) }
  if (shape.w < 2 || shape.h < 2) return
  const palette = ['#F0C820', '#5B8DEF', '#57A773', '#E8743B', '#9B5DE5', '#EF476F']
  try {
    const r: any = await $fetch('/api/v1/zones', {
      method: 'POST',
      body: { store_id: storeId.value, name: `Zone ${zones.value.length + 1}`, color: palette[zones.value.length % palette.length], shape },
    })
    zones.value.push(r.data); selected.value = r.data.id
  } catch (err: any) { error.value = err?.data?.message || 'Could not create zone' }
}

async function save(z: any) {
  try { await $fetch(`/api/v1/zones/${z.id}`, { method: 'PATCH', body: { name: z.name, color: z.color, shape: z.shape } }) }
  catch (err: any) { error.value = err?.data?.message || 'Could not save' }
}
async function remove(z: any) {
  try { await $fetch(`/api/v1/zones/${z.id}`, { method: 'DELETE' }); zones.value = zones.value.filter((x) => x.id !== z.id) }
  catch (err: any) { error.value = err?.data?.message || 'Could not delete' }
}

function onUpload(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = async () => {
    const dataUrl = String(reader.result)
    const img = new Image()
    img.onload = async () => {
      const a = img.naturalWidth && img.naturalHeight ? Math.round((img.naturalWidth / img.naturalHeight) * 1000) / 1000 : null
      try {
        await $fetch('/api/v1/zones/layout', { method: 'PUT', body: { store_id: storeId.value, image_data_url: dataUrl, source: 'image', aspect: a } })
        layoutImg.value = dataUrl; if (a) aspect.value = `${a} / 1`
      } catch (err: any) { error.value = err?.data?.message || 'Could not save layout (image may be too large)' }
    }
    img.src = dataUrl
  }
  reader.readAsDataURL(file)
}
</script>
