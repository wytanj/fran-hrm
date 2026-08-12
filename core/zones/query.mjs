// Store layouts + zones. Shared by REST and MCP. Zones are percentage rects so
// they render as a CSS overlay at any size and feed analytics/vision later.

export async function listZones(db, workspaceId, storeId) {
  const { data, error } = await db.from('store_zones')
    .select('id, store_id, name, code, color, shape, sort_order')
    .eq('workspace_id', workspaceId).eq('store_id', storeId)
    .order('sort_order').order('created_at')
  if (error) throw new Error(error.message)
  return data || []
}

export async function getLayout(db, workspaceId, storeId) {
  const { data } = await db.from('store_layouts')
    .select('store_id, image_data_url, source, aspect, updated_at')
    .eq('workspace_id', workspaceId).eq('store_id', storeId).maybeSingle()
  return data || null
}

export async function setLayout(db, workspaceId, storeId, { image_data_url, source, aspect, actorStaffId = null }) {
  const { data, error } = await db.from('store_layouts').upsert({
    store_id: storeId, workspace_id: workspaceId,
    image_data_url: image_data_url ?? null,
    source: source || 'image',
    aspect: aspect ?? null,
    updated_by: actorStaffId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'store_id' }).select('store_id, source, aspect, updated_at').single()
  if (error) throw new Error(error.message)
  return data
}

const clampPct = (v) => Math.max(0, Math.min(100, Number(v) || 0))
function cleanShape(shape) {
  const s = shape || {}
  return { type: 'rect', x: clampPct(s.x), y: clampPct(s.y), w: clampPct(s.w), h: clampPct(s.h) }
}

export async function createZone(db, workspaceId, storeId, input, { actorStaffId = null } = {}) {
  if (!input?.name?.trim()) throw new Error('Zone name is required')
  const { data, error } = await db.from('store_zones').insert({
    workspace_id: workspaceId,
    store_id: storeId,
    name: String(input.name).trim().slice(0, 80),
    code: input.code ? String(input.code).trim().slice(0, 20) : null,
    color: /^#[0-9a-fA-F]{6}$/.test(input.color) ? input.color : '#F0C820',
    shape: cleanShape(input.shape),
    sort_order: Number(input.sort_order) || 0,
    created_by: actorStaffId,
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function updateZone(db, workspaceId, id, patch) {
  const upd = { updated_at: new Date().toISOString() }
  if (patch.name !== undefined) upd.name = String(patch.name).trim().slice(0, 80)
  if (patch.code !== undefined) upd.code = patch.code ? String(patch.code).trim().slice(0, 20) : null
  if (patch.color !== undefined && /^#[0-9a-fA-F]{6}$/.test(patch.color)) upd.color = patch.color
  if (patch.shape !== undefined) upd.shape = cleanShape(patch.shape)
  if (patch.sort_order !== undefined) upd.sort_order = Number(patch.sort_order) || 0
  const { data, error } = await db.from('store_zones').update(upd)
    .eq('workspace_id', workspaceId).eq('id', id).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function deleteZone(db, workspaceId, id) {
  const { error } = await db.from('store_zones').delete().eq('workspace_id', workspaceId).eq('id', id)
  if (error) throw new Error(error.message)
  return { ok: true }
}
