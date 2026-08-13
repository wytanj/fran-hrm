// Versioned in-force people schema. Git authors the core document; Supabase
// holds the published snapshot. Exactly one row per workspace is in_force —
// the unique partial index plus publish_hrm_schema() make that swap ACID.

import { recordAudit } from '../audit/record.mjs'
import {
  assembleSchema, buildCoreSchema, hashSchema, loadWorkspaceOverlay, renderSchemaText,
} from './build.mjs'

export function compactVersion(row) {
  if (!row) return null
  return {
    id: row.id,
    version: row.version,
    content_hash: row.content_hash,
    core_hash: row.core_hash,
    git_sha: row.git_sha || null,
    git_dirty: !!row.git_dirty,
    git_describe: row.git_describe || null,
    in_force: !!row.in_force,
    published_at: row.published_at || null,
    published_by: row.published_by || null,
    created_at: row.created_at,
  }
}

export function presentVersion(row) {
  if (!row) return null
  return {
    ...compactVersion(row),
    schema: row.schema_json,
    // Re-render so wording tracks the current renderer; the JSON is what was published.
    text: row.schema_json ? renderSchemaText(row.schema_json) : row.schema_text,
  }
}

export async function getInForce(db, workspaceId) {
  const { data, error } = await db.from('hrm_schema_versions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('in_force', true)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

export async function getVersion(db, workspaceId, ref) {
  const raw = String(ref || '').trim()
  if (!raw) return null
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)
  let q = db.from('hrm_schema_versions').select('*').eq('workspace_id', workspaceId)
  q = isUuid ? q.eq('id', raw) : q.eq('version', Number(raw))
  const { data, error } = await q.maybeSingle()
  if (error) throw new Error(error.message)
  return data || null
}

export async function listVersions(db, workspaceId, { limit = 50 } = {}) {
  const { data, error } = await db.from('hrm_schema_versions')
    .select('id, version, content_hash, core_hash, git_sha, git_dirty, git_describe, in_force, published_at, published_by, created_at')
    .eq('workspace_id', workspaceId)
    .order('version', { ascending: false })
    .limit(Math.min(200, Math.max(1, Number(limit) || 50)))
  if (error) throw new Error(error.message)
  return data || []
}

export async function buildCurrentDocument(db, workspaceId) {
  const core = buildCoreSchema()
  const overlay = await loadWorkspaceOverlay(db, workspaceId)
  const schema = assembleSchema(core, overlay)
  return {
    schema,
    text: renderSchemaText(schema),
    core_hash: hashSchema(core),
    content_hash: hashSchema(schema),
  }
}

export async function snapshotCurrent(db, workspaceId, { git = {}, actor = {} } = {}) {
  const built = await buildCurrentDocument(db, workspaceId)
  const { data: existing } = await db.from('hrm_schema_versions')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('content_hash', built.content_hash)
    .maybeSingle()
  if (existing) return { row: existing, created: false, built }

  const { data: last } = await db.from('hrm_schema_versions')
    .select('version')
    .eq('workspace_id', workspaceId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle()
  const version = (last?.version || 0) + 1

  const { data, error } = await db.from('hrm_schema_versions').insert({
    workspace_id: workspaceId,
    version,
    content_hash: built.content_hash,
    core_hash: built.core_hash,
    git_sha: git.sha || null,
    git_dirty: !!git.dirty,
    git_describe: git.describe || null,
    schema_json: built.schema,
    schema_text: built.text,
  }).select().single()
  if (error) {
    // Unique race: another snapshot landed the same hash.
    if (String(error.message || '').includes('hrm_schema_versions')) {
      const { data: again } = await db.from('hrm_schema_versions')
        .select('*').eq('workspace_id', workspaceId).eq('content_hash', built.content_hash).maybeSingle()
      if (again) return { row: again, created: false, built }
    }
    throw new Error(error.message)
  }

  await recordAudit(db, {
    workspace_id: workspaceId,
    actor_kind: actor.actor_kind || 'system',
    actor_id: actor.actor_id || null,
    actor_name: actor.actor_name || 'schema-sync',
    source_type: actor.source_type || 'system',
    object_type: 'hrm_schema_versions',
    entity_id: data.id,
    operation: 'INSERT',
    after_data: compactVersion(data),
  })
  return { row: data, created: true, built }
}

export async function publishVersion(db, workspaceId, versionId, actor = {}) {
  const { data, error } = await db.rpc('publish_hrm_schema', {
    p_workspace_id: workspaceId,
    p_version_id: versionId,
    p_published_by: actor.actor_id || null,
  })
  if (error) throw new Error(error.message)
  const row = Array.isArray(data) ? data[0] : data
  await recordAudit(db, {
    workspace_id: workspaceId,
    actor_kind: actor.actor_kind || 'user',
    actor_id: actor.actor_id || null,
    actor_name: actor.actor_name || null,
    source_type: actor.source_type || 'web',
    object_type: 'hrm_schema_versions',
    entity_id: row.id,
    operation: 'UPDATE',
    after_data: compactVersion(row),
    metadata: { action: 'publish_in_force', version: row.version },
  })
  return row
}

/** First read of a workspace with no in-force row snapshots and publishes current. */
export async function ensureInForce(db, workspaceId, { git = {}, actor = {} } = {}) {
  const current = await getInForce(db, workspaceId)
  if (current) return { row: current, bootstrapped: false }
  const { row } = await snapshotCurrent(db, workspaceId, { git, actor })
  if (row.in_force) return { row, bootstrapped: true }
  const published = await publishVersion(db, workspaceId, row.id, actor)
  return { row: published, bootstrapped: true }
}

export function driftAgainst(inForceRow, currentCoreHash, currentContentHash) {
  if (!inForceRow) {
    return { drifted: true, reason: 'nothing_in_force', core_changed: true, overlay_changed: true }
  }
  const core_changed = inForceRow.core_hash !== currentCoreHash
  const overlay_changed = inForceRow.content_hash !== currentContentHash && !core_changed
  const both = inForceRow.content_hash !== currentContentHash
  return {
    drifted: both || core_changed,
    reason: core_changed ? 'core_changed' : (overlay_changed ? 'workspace_overlay_changed' : null),
    core_changed,
    overlay_changed,
  }
}
