#!/usr/bin/env node
// Sync docs/help/*.md into the help_articles table.
//
// Source of truth is the markdown files, so a behaviour change and its
// documentation land in the same commit and get reviewed together. Run this
// after editing any article (and in the deploy step) so the MCP help tools and
// /help serve current policy rather than whatever was true at first deploy.
//
//   node scripts/sync-help.mjs            sync all workspaces
//   node scripts/sync-help.mjs --check    report drift, change nothing (CI)
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadDotEnv() {
  try {
    const text = readFileSync(join(root, '.env'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (m && process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch {}
}
loadDotEnv()

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_SECRET_KEY are required')
  process.exit(1)
}
const db = createClient(url, key, { auth: { persistSession: false } })

const checkOnly = process.argv.includes('--check')

/**
 * Minimal YAML frontmatter parser — scalars and flow arrays ([a, b]) only,
 * which is all the article schema needs. Avoiding a yaml dependency keeps the
 * sync script runnable in a bare deploy step.
 */
function parseFrontmatter(text, file) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) throw new Error(`${file}: missing --- frontmatter block`)
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue
    const kv = line.match(/^([a-z_]+):\s*(.*)$/)
    if (!kv) throw new Error(`${file}: cannot parse frontmatter line: ${line}`)
    const [, k, rawValue] = kv
    const v = rawValue.trim()
    if (v.startsWith('[') && v.endsWith(']')) {
      meta[k] = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean)
    } else if (/^\d+$/.test(v)) {
      meta[k] = Number(v)
    } else if (v === 'true' || v === 'false') {
      meta[k] = v === 'true'
    } else {
      meta[k] = v.replace(/^["']|["']$/g, '')
    }
  }
  return { meta, body: m[2].trim() }
}

const dir = join(root, 'docs', 'help')
const files = readdirSync(dir).filter((f) => f.endsWith('.md')).sort()

const articles = files.map((file) => {
  const text = readFileSync(join(dir, file), 'utf8')
  const { meta, body } = parseFrontmatter(text, file)
  for (const required of ['slug', 'title']) {
    if (!meta[required]) throw new Error(`${file}: frontmatter is missing "${required}"`)
  }
  if (meta.slug !== file.replace(/\.md$/, '')) {
    throw new Error(`${file}: slug "${meta.slug}" must match the filename`)
  }
  return {
    slug: meta.slug,
    title: meta.title,
    summary: meta.summary || null,
    body_md: body,
    category: meta.category || 'general',
    primary_path: meta.primary_path || null,
    related_paths: meta.related_paths || [],
    intent_tags: meta.intent_tags || [],
    audience: meta.audience || [],
    sort_order: meta.sort_order ?? 100,
    published: meta.published !== false,
    source_path: `docs/help/${file}`,
    content_hash: createHash('sha256').update(text).digest('hex'),
  }
})

async function main() {
  const { data: workspaces, error: wsErr } = await db.from('workspaces').select('id, name')
  if (wsErr) throw new Error(wsErr.message)
  if (!workspaces?.length) {
    console.error('No workspaces found — run npm run db:seed first')
    process.exit(1)
  }

  let changed = 0
  let unchanged = 0

  for (const ws of workspaces) {
    const { data: existing } = await db
      .from('help_articles').select('slug, content_hash').eq('workspace_id', ws.id)
    const hashBySlug = new Map((existing || []).map((r) => [r.slug, r.content_hash]))

    for (const a of articles) {
      if (hashBySlug.get(a.slug) === a.content_hash) {
        unchanged += 1
        continue
      }
      changed += 1
      if (checkOnly) {
        console.log(`DRIFT  ${ws.name}: ${a.slug}`)
        continue
      }
      const { error } = await db.from('help_articles')
        .upsert({ ...a, workspace_id: ws.id, updated_at: new Date().toISOString() },
          { onConflict: 'workspace_id,slug' })
      if (error) throw new Error(`${a.slug}: ${error.message}`)
      console.log(`synced ${ws.name}: ${a.slug}`)
    }

    // Remove articles whose source file is gone, so deleting a doc actually
    // retires it instead of leaving stale policy answerable by the MCP tools.
    const slugs = articles.map((a) => a.slug)
    const orphans = (existing || []).filter((r) => !slugs.includes(r.slug))
    for (const o of orphans) {
      if (checkOnly) { console.log(`ORPHAN ${ws.name}: ${o.slug}`); continue }
      await db.from('help_articles').delete().eq('workspace_id', ws.id).eq('slug', o.slug)
      console.log(`removed ${ws.name}: ${o.slug} (source file deleted)`)
    }
  }

  if (checkOnly) {
    if (changed) {
      console.error(`\n${changed} article(s) differ from the database. Run: npm run help:sync`)
      process.exit(1)
    }
    console.log(`help centre in sync (${unchanged} article checks passed)`)
    return
  }
  console.log(`\nDone. ${changed} written, ${unchanged} already current, ${articles.length} articles total.`)
}

main().catch((err) => { console.error('help sync failed:', err.message); process.exit(1) })
