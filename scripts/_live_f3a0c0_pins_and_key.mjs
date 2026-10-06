import { readFileSync, existsSync, writeFileSync, unlinkSync } from "node:fs"
import { resolve } from "node:path"
import { createHash, randomBytes } from "node:crypto"
import { generatePosPin, pinExpiryFrom } from "../core/pos-auth/pin.mjs"
import bcrypt from "bcryptjs"
import postgres from "postgres"

function loadEnv(p) {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith("#")) continue
    const m = t.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[m[1]] === undefined) process.env[m[1]] = v
  }
}
loadEnv(resolve(".env"))

const WS = "3fbe7a05-9df5-4163-a02a-55e5d25967d3"
const SEED_WS = "11111111-1111-4111-8111-000000000001"
const sql = postgres(process.env.SUPABASE_CONNECTION_STRING, { ssl: "require", max: 1 })

const staff = await sql`
  select s.id, s.employee_code, s.display_name, s.email, s.role,
    s.pos_access_enabled, s.terminated_on, s.home_store_id,
    st.code as home_store_code, st.name as home_store_name
  from staff s
  left join stores st on st.id = s.home_store_id
  where s.workspace_id = ${WS}
  order by s.display_name nulls last, s.employee_code
`
console.log(JSON.stringify({ step: "list", count: staff.length, staff: staff.map(s => ({
  email: s.email, employee_code: s.employee_code, role: s.role,
  home_store: s.home_store_code, pos_access: s.pos_access_enabled, terminated: !!s.terminated_on
})) }, null, 2))

const stores = await sql`select id, code, name from stores where workspace_id = ${WS} order by code`
console.log(JSON.stringify({ step: "stores", stores }, null, 2))

const pinTable = []
const now = new Date()
const expires = pinExpiryFrom(now)
for (const s of staff) {
  if (s.terminated_on) {
    pinTable.push({
      name: s.display_name, email: s.email, employee_code: s.employee_code,
      role: s.role, store: s.home_store_code || s.home_store_name || null,
      pin: null, skipped: "terminated",
    })
    continue
  }
  const pin = generatePosPin()
  const hash = bcrypt.hashSync(pin, 10)
  await sql`
    update staff set
      pos_access_enabled = true,
      pin_hash = ${hash},
      pin_expires_at = ${expires.toISOString()},
      pin_rotated_at = ${now.toISOString()},
      failed_attempts = 0,
      locked_until = null,
      updated_at = ${now.toISOString()}
    where id = ${s.id}
  `
  // audit event if table exists
  await sql`
    insert into pos_auth_events (workspace_id, event_type, staff_id, employee_code, actor_name, detail)
    values (${WS}, 'hire_approve', ${s.id}, ${s.employee_code}, 'Engineer bulk PIN for S10', ${sql.json({ source: 'bulk_f3a0c0_go', pin_ttl_months: 12 })})
  `.catch(() => null)

  pinTable.push({
    name: s.display_name, email: s.email, employee_code: s.employee_code,
    role: s.role, store: s.home_store_code || null,
    pin, pin_expires_at: expires.toISOString(), skipped: null,
  })
}
writeFileSync("C:/Users/Jeremy Tan/CodeProjects/tmp/hrm-f3a0c0-pins.json", JSON.stringify(pinTable, null, 2), { mode: 0o600 })
console.log(JSON.stringify({ step: "pins_set", issued: pinTable.filter(p => p.pin).length, skipped: pinTable.filter(p => p.skipped).length }))

// Remint API key on live WS; deactivate old seed key
const raw = `sk_live_${randomBytes(32).toString("base64url")}`
const hash = createHash("sha256").update(raw).digest("hex")
const prefix = raw.slice(0, 16)
await sql`
  update api_keys set is_active = false, revoked_at = now()
  where name = 'fran-pos-verify-p0' and workspace_id = ${SEED_WS} and revoked_at is null
`
const [keyRow] = await sql`
  insert into api_keys (workspace_id, name, prefix, key_hash, scopes, is_active)
  values (${WS}, ${"fran-pos-verify-p0"}, ${prefix}, ${hash}, ARRAY['pos:verify']::text[], true)
  returning id, name, prefix, workspace_id, scopes
`
writeFileSync("C:/Users/Jeremy Tan/CodeProjects/tmp/fran-pos-hrm-api-key.raw", raw, { mode: 0o600 })
console.log(JSON.stringify({ step: "key_minted", id: keyRow.id, prefix: keyRow.prefix, workspace_id: keyRow.workspace_id, scopes: keyRow.scopes }))

await sql.end({ timeout: 5 })
