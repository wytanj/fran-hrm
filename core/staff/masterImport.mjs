// Staff master CSV/TSV import — draft-first diff against live staff.
// CSV = identity + pay rates only. Hours SoT is POS QR → time_entries (not this file).
// No auto-write: commit only after staff_master_import_commit with confirm=true.

import { createHash, randomUUID } from "node:crypto"
import { parseSheet } from "../import/parse.mjs"
import { createStaffRecord, updateStaffRecord } from "./profile.mjs"

const FIELD_ALIASES = {
  employee_code: ["employee_code", "employee code", "emp_code", "staff_code", "code"],
  display_name: ["display_name", "display name", "name", "full_name", "full name"],
  email: ["email", "email_address", "email address"],
  employment_type: ["employment_type", "employment type", "type", "ft_pt"],
  hired_on: ["hired_on", "hired on", "hire_date", "hire date", "start_date"],
  payroll_eligible_from: ["payroll_eligible_from", "payroll eligible from", "eligible_from", "pay_from"],
  date_of_birth: ["date_of_birth", "date of birth", "dob", "birth_date"],
  nric: ["nric", "fin", "nric_fin", "id_number"],
  race: ["race", "ethnicity"],
  religion: ["religion"],
  residency: ["residency", "citizenship", "resident_status"],
  pr_start_date: ["pr_start_date", "pr start date", "pr_start", "pr_date"],
  pr_cpf_type: ["pr_cpf_type", "pr cpf type", "cpf_type"],
  bank_bic: ["bank_bic", "bank bic", "bic", "swift", "swift_bic"],
  bank_account_name: ["bank_account_name", "bank account name", "account_name", "acct_name"],
  bank_account_no: ["bank_account_no", "bank account no", "account_no", "acct_no", "bank_account_number"],
  monthly_salary_cents: [
    "monthly_salary_cents", "basic_salary_cents", "basic_salary", "basic salary",
    "monthly_salary", "salary_cents", "basic_pay_cents",
  ],
  hourly_rate_cents: ["hourly_rate_cents", "hourly_rate", "hourly rate", "hourly"],
  cpf_applicable: ["cpf_applicable", "cpf applicable", "cpf"],
  shg_opt_out: ["shg_opt_out", "shg opt out", "shg_optout"],
  work_pass_type: ["work_pass_type", "work pass type", "pass_type", "work_pass"],
  work_pass_no: ["work_pass_no", "work pass no", "pass_no"],
  work_pass_expires_on: ["work_pass_expires_on", "work_pass_expiry", "pass_expires", "work_pass_expires"],
}

const HOURS_HINT = /^(hours|hours_worked|ot_hours|overtime|total_hours|shift_hours|clock_hours)$/i

/** Partial SG bank BIC allowlist (8-char). Extend when finance confirms more. */
export const KNOWN_BANK_BICS = new Set([
  "DBSSSGSG", "OCBCSGSG", "UOVBSGSG", "SCBLSG2", "HSBCSGS2", "CITISGSG",
  "MHBCSGSG", "BOFASG2X", "BKCHSGSG", "ICICSGSG", "MBBESGSG", "SBININSG",
  "CPRBSGSG", "HLBBSGSG", "RJHISGSG", "BOTKSGSX",
])

const TRACKED = [
  "display_name", "email", "employment_type", "hired_on", "payroll_eligible_from", "date_of_birth",
  "nric", "race", "religion", "residency", "pr_start_date", "pr_cpf_type", "bank_bic",
  "bank_account_name", "bank_account_no", "monthly_salary_cents", "hourly_rate_cents",
  "cpf_applicable", "shg_opt_out", "work_pass_type", "work_pass_no", "work_pass_expires_on",
]

function normHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/[\s-]+/g, "_")
}

function mapHeaders(headers) {
  const mapping = {}
  const unused = []
  const hoursCols = []
  for (const h of headers) {
    const n = normHeader(h)
    if (HOURS_HINT.test(n) || (n.includes("hour") && !n.includes("hourly_rate"))) {
      hoursCols.push(h)
      continue
    }
    let hit = null
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (aliases.some((a) => normHeader(a) === n)) { hit = field; break }
    }
    if (hit) mapping[hit] = h
    else unused.push(h)
  }
  return { mapping, unused, hoursCols }
}

function parseBool(v) {
  if (v == null || v === "") return undefined
  const s = String(v).trim().toLowerCase()
  if (["1", "true", "yes", "y"].includes(s)) return true
  if (["0", "false", "no", "n"].includes(s)) return false
  return undefined
}

function parseCents(v) {
  if (v == null || v === "") return undefined
  const s = String(v).trim().replace(/[$,]/g, "")
  if (!s) return undefined
  if (/^-?\d+$/.test(s)) {
    const n = Number(s)
    return Math.abs(n) >= 1000 ? Math.round(n) : Math.round(n * 100)
  }
  const n = Number(s)
  if (!Number.isFinite(n)) return undefined
  return Math.round(n * 100)
}

function parseDate(v) {
  if (v == null || v === "") return undefined
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/)
  if (m) {
    const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3])
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
      return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`
    }
  }
  return null
}

/** Singapore NRIC/FIN checksum. */
export function validateNricChecksum(raw) {
  if (!raw) return { ok: false, reason: "missing" }
  const nric = String(raw).trim().toUpperCase()
  if (!/^[STFGM]\d{7}[A-Z]$/.test(nric)) return { ok: false, reason: "format" }
  const prefix = nric[0]
  const digits = nric.slice(1, 8).split("").map(Number)
  const weights = [2, 7, 6, 5, 4, 3, 2]
  let sum = digits.reduce((a, d, i) => a + d * weights[i], 0)
  if (prefix === "T" || prefix === "G") sum += 4
  if (prefix === "M") sum += 3
  const st = "JZIHGFEDCBA"
  const fg = "XWUTRQPNMLK"
  const mSeries = "KLPNRTUVWJX"
  const rem = sum % 11
  let expected
  if (prefix === "S" || prefix === "T") expected = st[rem]
  else if (prefix === "F" || prefix === "G") expected = fg[rem]
  else expected = mSeries[rem]
  if (nric[8] !== expected) return { ok: false, reason: "checksum" }
  return { ok: true, nric }
}

function normEmploymentType(v) {
  if (v == null || v === "") return undefined
  const s = String(v).trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (["ft", "full_time", "fulltime"].includes(s)) return "full_time"
  if (["pt", "part_time", "parttime"].includes(s)) return "part_time"
  if (s === "contractor") return "contractor"
  return s
}

function normResidency(v) {
  if (v == null || v === "") return undefined
  const s = String(v).trim().toLowerCase().replace(/[\s-]+/g, "_")
  if (["sc", "singaporean", "citizen"].includes(s)) return "citizen"
  if (["pr", "permanent_resident"].includes(s)) return "pr"
  if (["foreigner", "ep", "s_pass", "work_permit", "wp", "foreign"].includes(s)) return "foreigner"
  return s
}

function raceNeedsReligionForMbmf(race) {
  return String(race || "").toLowerCase() === "malay"
}

function draftHash(ops) {
  return createHash("sha256").update(JSON.stringify(ops)).digest("hex")
}

function rowToPatch(row, mapping) {
  const get = (field) => {
    const h = mapping[field]
    if (!h) return undefined
    const v = row[h]
    if (v == null) return undefined
    const t = String(v).trim()
    return t === "" ? undefined : t
  }

  const patch = {}
  const errors = []

  const code = get("employee_code")
  if (code) patch.employee_code = code.toUpperCase()

  const name = get("display_name")
  if (name) patch.display_name = name

  const email = get("email")
  if (email) patch.email = email.toLowerCase()

  const etRaw = get("employment_type")
  if (etRaw !== undefined) {
    const et = normEmploymentType(etRaw)
    if (!["full_time", "part_time", "contractor"].includes(et)) {
      errors.push({ field: "employment_type", code: "invalid_employment_type", message: `Unknown employment_type "${etRaw}"` })
    } else {
      patch.employment_type = et
    }
  }

  for (const field of ["hired_on", "payroll_eligible_from", "date_of_birth", "pr_start_date", "work_pass_expires_on"]) {
    if (!mapping[field]) continue
    const raw = get(field)
    if (raw === undefined) continue
    const d = parseDate(raw)
    if (d === null) errors.push({ field, code: "invalid_date", message: `Bad date "${raw}" (want YYYY-MM-DD or DD/MM/YYYY)` })
    else if (d) patch[field] = d
  }

  const nricRaw = get("nric")
  if (nricRaw !== undefined) {
    const v = validateNricChecksum(nricRaw)
    if (!v.ok) errors.push({ field: "nric", code: "invalid_nric", message: `NRIC/FIN failed ${v.reason}` })
    else patch.nric = v.nric
  }

  for (const f of ["race", "religion", "pr_cpf_type", "bank_account_name", "bank_account_no", "work_pass_type", "work_pass_no"]) {
    const v = get(f)
    if (v === undefined) continue
    if (["race", "religion", "pr_cpf_type", "work_pass_type"].includes(f)) patch[f] = v.toLowerCase()
    else patch[f] = v
  }

  const resRaw = get("residency")
  if (resRaw !== undefined) {
    const res = normResidency(resRaw)
    if (!["citizen", "pr", "foreigner"].includes(res)) {
      errors.push({ field: "residency", code: "invalid_residency", message: `Unknown residency "${resRaw}"` })
    } else {
      patch.residency = res
    }
  }

  const bic = get("bank_bic")
  if (bic !== undefined) {
    const b = bic.toUpperCase().replace(/\s+/g, "")
    if (!/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(b)) {
      errors.push({ field: "bank_bic", code: "invalid_bic_format", message: `BIC format invalid: ${bic}` })
    } else if (!KNOWN_BANK_BICS.has(b.slice(0, 8)) && !KNOWN_BANK_BICS.has(b)) {
      errors.push({ field: "bank_bic", code: "unknown_bic", message: `BIC not in allowlist: ${b}` })
    } else {
      patch.bank_bic = b
    }
  }

  for (const f of ["monthly_salary_cents", "hourly_rate_cents"]) {
    if (!mapping[f]) continue
    const raw = get(f)
    if (raw === undefined) continue
    const c = parseCents(raw)
    if (c === undefined || !Number.isFinite(c)) {
      errors.push({ field: f, code: "invalid_cents", message: `Bad money value "${raw}"` })
    } else {
      patch[f] = c
    }
  }

  const cpf = parseBool(get("cpf_applicable"))
  if (cpf !== undefined) patch.cpf_applicable = cpf
  const shg = parseBool(get("shg_opt_out"))
  if (shg !== undefined) patch.shg_opt_out = shg

  return { patch, errors }
}

function diffFields(live, patch) {
  const changes = {}
  for (const k of TRACKED) {
    if (!(k in patch)) continue
    const a = live?.[k] ?? null
    const b = patch[k] ?? null
    const na = a == null || a === "" ? null : a
    const nb = b == null || b === "" ? null : b
    if (String(na) !== String(nb)) changes[k] = { from: na, to: nb }
  }
  return changes
}

/** Dry-run staff master import. Never writes. */
export async function staffMasterImportDiff(db, workspaceId, input) {
  if (!input?.text || !String(input.text).trim()) {
    throw new Error(
      "text is required — paste CSV/TSV of the staff master (header row included). Hours columns are ignored; hours SoT is POS QR → time_entries.",
    )
  }
  const sheet = parseSheet(String(input.text))
  const headers = sheet.headers || []
  const rows = sheet.rows || []
  const { mapping, unused, hoursCols } = mapHeaders(headers)
  if (!mapping.employee_code && !mapping.email) {
    throw new Error("Sheet must include employee_code and/or email column to match live staff.")
  }

  const { data: liveRows, error } = await db
    .from("staff")
    .select(
      "id, employee_code, display_name, email, employment_type, employment_status, hired_on, payroll_eligible_from, date_of_birth, nric, race, religion, residency, pr_start_date, pr_cpf_type, bank_bic, bank_account_name, bank_account_no, monthly_salary_cents, hourly_rate_cents, cpf_applicable, shg_opt_out, work_pass_type, work_pass_no, work_pass_expires_on",
    )
    .eq("workspace_id", workspaceId)
    .neq("employment_status", "terminated")
  if (error) throw new Error(error.message)

  const live = liveRows || []
  const byCode = new Map(live.filter((r) => r.employee_code).map((r) => [String(r.employee_code).toUpperCase(), r]))
  const byEmail = new Map(live.filter((r) => r.email).map((r) => [String(r.email).toLowerCase(), r]))

  const added = []
  const changed = []
  const rowErrors = []
  const seenIds = new Set()
  const ops = []

  rows.forEach((row, idx) => {
    const rowNum = (sheet.headerIndex ?? 0) + idx + 2
    const { patch, errors } = rowToPatch(row, mapping)
    for (const e of errors) rowErrors.push({ row: rowNum, ...e })

    const code = patch.employee_code
    const email = patch.email
    const match = (code && byCode.get(code)) || (email && byEmail.get(email)) || null

    if (!match) {
      if (!patch.display_name) {
        rowErrors.push({ row: rowNum, field: "display_name", code: "missing_display_name", message: "display_name required for new hire" })
      }
      if (!patch.hired_on) {
        rowErrors.push({ row: rowNum, field: "hired_on", code: "missing_hired_on", message: "hired_on required for new hire" })
      }
      if (patch.employment_type === "part_time" && patch.hourly_rate_cents == null) {
        rowErrors.push({ row: rowNum, field: "hourly_rate_cents", code: "pt_missing_hourly", message: "PT new hire needs hourly_rate_cents" })
      }
      if (patch.employment_type === "full_time" && patch.monthly_salary_cents == null) {
        rowErrors.push({
          row: rowNum,
          field: "monthly_salary_cents",
          code: "ft_missing_basic",
          message: "FT new hire needs monthly_salary_cents / basic_salary_cents",
        })
      }
      if (raceNeedsReligionForMbmf(patch.race) && !patch.religion) {
        rowErrors.push({
          row: rowNum,
          field: "religion",
          code: "religion_required_for_mbmf",
          message: "religion required when race→MBMF path",
        })
      }
    }

    const blocking = rowErrors.filter((e) => e.row === rowNum)

    if (!match) {
      const op = { op: "create", row: rowNum, patch }
      added.push({ row: rowNum, employee_code: code || null, display_name: patch.display_name || null, patch, errors: blocking })
      if (blocking.length === 0) ops.push(op)
      return
    }

    seenIds.add(match.id)
    const changes = diffFields(match, patch)
    if (Object.keys(changes).length === 0 && blocking.length === 0) return
    const op = { op: "update", row: rowNum, staff_id: match.id, employee_code: match.employee_code, patch, changes }
    changed.push({
      row: rowNum,
      staff_id: match.id,
      employee_code: match.employee_code,
      display_name: match.display_name,
      changes,
      errors: blocking,
    })
    if (blocking.length === 0 && Object.keys(changes).length) ops.push(op)
  })

  const removed = live
    .filter((r) => !seenIds.has(r.id))
    .map((r) => ({
      staff_id: r.id,
      employee_code: r.employee_code,
      display_name: r.display_name,
      note: "Present in live staff, absent from file — flagged only; commit will NOT terminate.",
    }))

  const hash = draftHash(ops)
  const errorRowCount = new Set(rowErrors.map((e) => e.row)).size

  return {
    draft_id: randomUUID(),
    draft_hash: hash,
    hours_sot: "POS QR punches → time_entries. This CSV is identity + pay rates only; hours columns were ignored.",
    mapping,
    unused_columns: unused,
    ignored_hours_columns: hoursCols,
    summary: {
      rows_in_file: rows.length,
      added: added.length,
      changed: changed.length,
      removed_flagged: removed.length,
      error_rows: errorRowCount,
      apply_ops: ops.length,
    },
    added,
    changed,
    removed,
    errors: rowErrors,
    ops,
    next_allowed_actions: ops.length && errorRowCount === 0 ? ["staff_master_import_commit"] : ["staff_master_import_diff"],
    note: "Draft only — nothing written. After explicit approve, call staff_master_import_commit with the same ops + draft_hash and confirm=true.",
  }
}

/** Apply a previously previewed ops list. Refuses unless confirm===true and draft_hash matches. */
export async function staffMasterImportCommit(db, workspaceId, { ops, draft_hash, confirm, actor } = {}) {
  if (confirm !== true) {
    throw new Error("Refusing to write: pass confirm=true after explicit human approve of the diff.")
  }
  if (!Array.isArray(ops)) throw new Error("ops array from staff_master_import_diff is required")
  const hash = draftHash(ops)
  if (!draft_hash || draft_hash !== hash) {
    throw new Error("draft_hash mismatch — re-run staff_master_import_diff and commit the returned ops unchanged.")
  }

  const results = []
  for (const op of ops) {
    if (op.op === "create") {
      const created = await createStaffRecord(db, workspaceId, op.patch, actor || {})
      results.push({
        op: "create",
        staff_id: created?.id || created?.staff?.id || null,
        employee_code: op.patch.employee_code,
      })
    } else if (op.op === "update") {
      const updated = await updateStaffRecord(db, workspaceId, op.staff_id, op.patch, actor || {})
      results.push({
        op: "update",
        staff_id: op.staff_id,
        employee_code: op.employee_code,
        updated: !!updated,
      })
    } else {
      throw new Error(`Unknown op ${op.op}`)
    }
  }

  return {
    written: results.length,
    results,
    note: "Removed-from-file rows were not touched. Hours unchanged (POS QR → time_entries).",
  }
}
