#!/usr/bin/env node
// Snapshot the people schema into hrm_schema_versions and keep one row in force.
//
//   node scripts/sync-hrm-schema.mjs           insert a new version if the
//                                              document changed; bootstrap
//                                              in_force when a workspace has none
//   node scripts/sync-hrm-schema.mjs --check   fail if git dump is stale, or if
//                                              the in-force core_hash ≠ current
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'
import { buildCoreSchema, hashSchema } from '../core/hrm-schema/build.mjs'
import { readGitMeta } from '../core/hrm-schema/git.mjs'
import { buildCurrentDocument, driftAgainst, ensureInForce, getInForce, snapshotCurrent } from '../core/hrm-schema/store.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadDotEnv() {
  try {
    const text = readFileSync(join(root, '.env'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* env may already be set */ }
}
loadDotEnv()

const checkOnly = process.argv.includes('--check')
const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY are required')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })
const git = readGitMeta(root)
const core = buildCoreSchema()
const coreHash = hashSchema(core)

async function main() {
  const { data: workspaces, error } = await db.from('workspaces').select('id, name')
  if (error) throw new Error(error.message)
  if (!workspaces?.length) {
    console.error('No workspaces found — run npm run db:seed first')
    process.exit(1)
  }

  let drifted = 0
  for (const ws of workspaces) {
    if (checkOnly) {
      const live = await getInForce(db, ws.id)
      if (!live) {
        console.error(`DRIFT  ${ws.name}: nothing in force`)
        drifted += 1
        continue
      }
      const built = await buildCurrentDocument(db, ws.id)
      const d = driftAgainst(live, coreHash, built.content_hash)
      if (d.core_changed) {
        console.error(`DRIFT  ${ws.name}: in-force v${live.version} core ${live.core_hash.slice(0, 12)} ≠ git ${coreHash.slice(0, 12)}`)
        drifted += 1
      } else if (d.overlay_changed) {
        console.log(`note   ${ws.name}: workspace overlay changed since v${live.version} (custom fields / functions / leave types). Publish a new snapshot from /hrm-schema.`)
      } else {
        console.log(`ok     ${ws.name}: v${live.version} in force`)
      }
      continue
    }

    const { row, created } = await snapshotCurrent(db, ws.id, {
      git,
      actor: { actor_kind: 'system', actor_name: 'schema-sync', source_type: 'system' },
    })
    const { row: force, bootstrapped } = await ensureInForce(db, ws.id, {
      git,
      actor: { actor_kind: 'system', actor_name: 'schema-sync', source_type: 'system' },
    })
    const bits = [
      created ? `snapshotted v${row.version}` : `unchanged v${row.version}`,
      force.in_force ? `in force v${force.version}` : 'no in-force',
      bootstrapped ? 'bootstrapped' : null,
      git.describe ? `git ${git.describe}` : null,
    ].filter(Boolean)
    console.log(`${ws.name}: ${bits.join(' · ')}`)
  }

  if (checkOnly) {
    if (drifted) {
      console.error(`\n${drifted} workspace(s) are not on the git people schema. Open /hrm-schema as HQ and publish, or run: npm run schema:sync && publish from the UI.`)
      process.exit(1)
    }
    console.log(`hrm schema in force (${workspaces.length} workspace(s))`)
  }
}

main().catch((err) => { console.error('hrm schema sync failed:', err.message); process.exit(1) })
