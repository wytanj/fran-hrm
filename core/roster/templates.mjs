// Shift templates ("hour blocks"): the named start/end/break windows that
// become columns on the roster-builder cover grid. Shared by REST; managers
// create and retire these from the web UI so seed is not the only source.

import { recordAudit } from '../audit/record.mjs'
import { minutesOf, normaliseTime } from './constraints.mjs'

const TEMPLATE_SELECT = 'id, store_id, name, start_time, end_time, break_minutes, job_code, is_active'
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function actorPayload(actor = {}) {
  return {
    workspace_id: actor.workspace_id,
    actor_kind: actor.actor_kind || 'user',
    actor_id: actor.actor_id || null,
    actor_name: actor.actor_name || null,
    source_type: actor.source_type || 'web',
  }
}

export function compactTemplate(row) {
  if (!row) return row
  return {
    id: row.id,
    store_id: row.store_id || null,
    name: row.name,
    start_time: String(row.start_time || '').slice(0, 5),
    end_time: String(row.end_time || '').slice(0, 5),
    break_minutes: row.break_minutes,
    job_code: row.job_code || null,
    is_active: row.is_active !== false,
    store: row.store ? { id: row.store.id, code: row.store.code, name: row.store.name } : null,
  }
}

/**
 * Normalise and validate a template payload.
 *
 * @param {object} input
 * @param {{ existing?: object }} [opts]  existing row → PATCH (omitted fields kept)
 * @returns {{ name: string, start: string, end: string, break_minutes: number, store_id: string|null|undefined, job_code: string|null|undefined }}
 */
export function validateTemplateInput(input, { existing } = {}) {
  const src = input && typeof input === 'object' ? input : {}
  const updating = !!existing

  const nameRaw = src.name !== undefined ? src.name : existing?.name
  const name = String(nameRaw ?? '').trim()
  if (!name) throw new Error('name is required')

  const startRaw = src.start ?? src.start_time
  const endRaw = src.end ?? src.end_time
  const startSource = startRaw !== undefined && startRaw !== null && String(startRaw).trim() !== ''
    ? startRaw
    : (existing ? existing.start_time ?? existing.start : startRaw)
  const endSource = endRaw !== undefined && endRaw !== null && String(endRaw).trim() !== ''
    ? endRaw
    : (existing ? existing.end_time ?? existing.end : endRaw)

  const start = normaliseTime(startSource)
  const end = normaliseTime(endSource)
  if (!start) {
    const shown = startSource == null || String(startSource).trim() === '' ? '' : String(startSource).trim()
    throw new Error(shown
      ? `start "${shown}" is not a time. Use HH:MM (e.g. 09:30).`
      : 'start is required (HH:MM, e.g. 09:30).')
  }
  if (!end) {
    const shown = endSource == null || String(endSource).trim() === '' ? '' : String(endSource).trim()
    throw new Error(shown
      ? `end "${shown}" is not a time. Use HH:MM (e.g. 09:30).`
      : 'end is required (HH:MM, e.g. 09:30).')
  }
  if (minutesOf(end) <= minutesOf(start)) {
    throw new Error(`end (${end}) must be after start (${start}). Overnight shifts are not supported yet.`)
  }

  let breakMinutes
  if (src.break_minutes === undefined || src.break_minutes === null || src.break_minutes === '') {
    breakMinutes = updating ? Number(existing.break_minutes) : 60
  } else {
    const n = Number(src.break_minutes)
    if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
      throw new Error('break_minutes must be a non-negative integer')
    }
    breakMinutes = n
  }

  let storeId
  if (src.store_id === undefined) {
    storeId = updating ? undefined : null
  } else if (src.store_id === null || src.store_id === '' || src.store_id === 'shared') {
    storeId = null
  } else {
    storeId = String(src.store_id).trim()
  }

  let jobCode
  if (src.job_code === undefined) {
    jobCode = updating ? undefined : null
  } else if (src.job_code === null || String(src.job_code).trim() === '') {
    jobCode = null
  } else {
    jobCode = String(src.job_code).trim()
  }

  return { name, start, end, break_minutes: breakMinutes, store_id: storeId, job_code: jobCode }
}

async function resolveStoreId(db, workspaceId, ref) {
  if (ref == null || ref === '') return null
  const key = String(ref).trim()
  if (!key) return null
  const isUuid = UUID_RE.test(key)
  let q = db.from('stores').select('id').eq('workspace_id', workspaceId)
  q = isUuid ? q.eq('id', key) : q.eq('code', key.toUpperCase())
  const { data, error } = await q.maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error(`No store "${key}" in this workspace.`)
  return data.id
}

async function loadTemplate(db, workspaceId, id) {
  const key = String(id || '').trim()
  if (!key) throw new Error('template id is required')
  const { data, error } = await db.from('shift_templates')
    .select(TEMPLATE_SELECT)
    .eq('workspace_id', workspaceId)
    .eq('id', key)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

/**
 * A store's usable templates are the shared ones (store_id is null) plus its
 * own. With no store_id, return every template in the workspace.
 */
export async function listTemplates(db, workspaceId, { store_id, includeInactive = false } = {}) {
  let q = db.from('shift_templates')
    .select(`${TEMPLATE_SELECT}, store:store_id(id, code, name)`)
    .eq('workspace_id', workspaceId)
    .order('start_time')
    .order('name')
  if (!includeInactive) q = q.eq('is_active', true)
  if (store_id) {
    const sid = String(store_id).trim()
    if (!UUID_RE.test(sid)) throw new Error(`store_id "${store_id}" is not a valid id.`)
    q = q.or(`store_id.is.null,store_id.eq.${sid}`)
  }
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data || []).map(compactTemplate)
}

export async function upsertTemplate(db, workspaceId, input, actor = {}) {
  const id = input?.id ? String(input.id).trim() : ''
  const existing = id ? await loadTemplate(db, workspaceId, id) : null
  if (id && !existing) throw new Error(`No shift template "${id}".`)

  const parsed = validateTemplateInput(input, { existing })
  const storeId = parsed.store_id === undefined
    ? existing.store_id
    : await resolveStoreId(db, workspaceId, parsed.store_id)

  const payload = {
    name: parsed.name,
    start_time: parsed.start,
    end_time: parsed.end,
    break_minutes: parsed.break_minutes,
    store_id: storeId,
    updated_at: new Date().toISOString(),
  }
  if (parsed.job_code !== undefined) payload.job_code = parsed.job_code

  let row
  if (existing) {
    const { data, error } = await db.from('shift_templates')
      .update(payload)
      .eq('workspace_id', workspaceId)
      .eq('id', existing.id)
      .select(TEMPLATE_SELECT)
      .single()
    if (error) throw new Error(error.message)
    row = data
  } else {
    const { data, error } = await db.from('shift_templates')
      .insert({
        workspace_id: workspaceId,
        ...payload,
        job_code: parsed.job_code ?? null,
        is_active: true,
      })
      .select(TEMPLATE_SELECT)
      .single()
    if (error) throw new Error(error.message)
    row = data
  }

  const after = compactTemplate(row)
  await recordAudit(db, {
    ...actorPayload({ ...actor, workspace_id: workspaceId }),
    object_type: 'shift_template',
    entity_id: row.id,
    operation: existing ? 'UPDATE' : 'CREATE',
    before_data: existing ? compactTemplate(existing) : null,
    after_data: after,
  })
  return after
}

export async function deactivateTemplate(db, workspaceId, id, actor = {}) {
  const existing = await loadTemplate(db, workspaceId, id)
  if (!existing) throw new Error(`No shift template "${id}".`)

  const { data, error } = await db.from('shift_templates')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', existing.id)
    .select(TEMPLATE_SELECT)
    .single()
  if (error) throw new Error(error.message)

  const after = compactTemplate(data)
  await recordAudit(db, {
    ...actorPayload({ ...actor, workspace_id: workspaceId }),
    object_type: 'shift_template',
    entity_id: existing.id,
    operation: 'DEACTIVATE',
    before_data: compactTemplate(existing),
    after_data: after,
  })
  return { ok: true, id: existing.id, name: existing.name }
}
