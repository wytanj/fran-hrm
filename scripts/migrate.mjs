#!/usr/bin/env node
// FranHRM migration runner (same doctrine as fran-pos/fran-skums: numbered
// SQL files, sha256 checksums, tracked in hrm_migrations, custom runner —
// not the Supabase CLI). Usage:
//   node scripts/migrate.mjs            apply pending
//   node scripts/migrate.mjs --status   show applied/pending
//   node scripts/migrate.mjs --dry-run  list what would run
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import postgres from 'postgres'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function loadDotEnv() {
  try {
    const text = readFileSync(join(root, '.env'), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
      if (!m) continue
      if (process.env[m[1]] != null) continue
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
    }
  } catch { /* no .env is fine when env vars are set */ }
}

loadDotEnv()

const connectionString = process.env.SUPABASE_CONNECTION_STRING
if (!connectionString) {
  console.error('SUPABASE_CONNECTION_STRING is required')
  process.exit(1)
}

const sql = postgres(connectionString, { ssl: 'require', max: 1, prepare: false })

const dir = join(root, 'core', 'db')
const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort()

const status = process.argv.includes('--status')
const dryRun = process.argv.includes('--dry-run')

async function main() {
  await sql`
    create table if not exists public.hrm_migrations (
      name text primary key,
      checksum text not null,
      applied_at timestamptz not null default now()
    )`
  await sql`alter table public.hrm_migrations enable row level security`

  const applied = new Map(
    (await sql`select name, checksum from public.hrm_migrations`).map((r) => [r.name, r.checksum]),
  )

  for (const file of files) {
    const body = readFileSync(join(dir, file), 'utf8')
    const checksum = createHash('sha256').update(body).digest('hex')
    if (applied.has(file)) {
      if (applied.get(file) !== checksum) {
        console.error(`CHECKSUM MISMATCH: ${file} changed after being applied. Refusing to continue.`)
        process.exit(1)
      }
      if (status) console.log(`applied  ${file}`)
      continue
    }
    if (status || dryRun) {
      console.log(`pending  ${file}`)
      continue
    }
    console.log(`applying ${file} ...`)
    await sql.begin(async (tx) => {
      await tx.unsafe(body)
      await tx`insert into public.hrm_migrations (name, checksum) values (${file}, ${checksum})`
    })
    console.log(`applied  ${file}`)
  }
  await sql.end()
}

main().catch((err) => {
  console.error('migration failed:', err.message)
  process.exit(1)
})
