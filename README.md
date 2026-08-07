# FranHRM

HR system for the Fran retail stack — the source of truth for **all Fran staff** (HQ + stores). Owns the staff master record, manpower scheduling (rosters, availability, swaps), time & attendance (QR clocking, corrections, OT/adherence flags, payroll lock) and leave.

Sibling systems: **fran-skums** (product/inventory), **fran-pos** (registers), **fran-crm** (loyalty). Each runs its own Supabase project; integration is HTTP + API key, never shared databases.

## Stack

- **Nuxt 4** (app + Nitro API + remote MCP endpoint), Tailwind. **Desktop-web-first**: fixed sidebar, dense data tables, a staff × day roster matrix; mobile is the responsive fallback (drawer nav, day-list roster). Brand palette ported from fran-mobile (warm cream/yellow/brown ink, brown low-opacity shadows, generous radii)
- **Supabase Postgres** via service key only — RLS is enabled with zero policies on every table; tenancy enforced in code by `workspace_id` filters
- **Auth**: staff sessions (employee code/email + PIN, bcrypt, httpOnly cookie) for the web app — staff are *not* Supabase Auth users (same doctrine as fran-pos floor staff). API keys (`sk_live_…`, sha256-stored, scoped) for headless callers.
- **MCP**: `@modelcontextprotocol/sdk` stdio server + hand-rolled stateless JSON-RPC over HTTP, one shared tool layer (fran-skums pattern)

## Setup

```bash
npm install
npm run db:migrate     # numbered SQL in core/db/, tracked in hrm_migrations
npm run db:seed        # demo workspace/stores/staff/rosters/clock data + API key (printed once)
npm run help:sync      # docs/help/*.md → help_articles
npm run dev
```

`.env` (see `.env.example`): `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_CONNECTION_STRING` (migrations only).

**Demo logins** (PIN `123456`): `HQ001` hq_admin · `AM001` area_manager · `SM001` store_manager · `SV001` supervisor · `ST001` staff FT · `PT001`/`PT002` staff PT.

## Layout

```
core/            shared plain .mjs — used verbatim by REST routes AND MCP tools
  db/            numbered SQL migrations
  hours/compute.mjs      worked-hours + OT computation (the payroll-grade number)
  staff|roster|attendance|leave/query.mjs   domain queries
  audit/record.mjs       append-only audit writer
mcp/             MCP server (stdio entry, HTTP protocol, tools, scopes)
server/
  api/auth/      session login/logout/me
  api/v1/        REST API (dual auth: session cookie OR API key)
  routes/mcp/    remote MCP endpoint (/mcp, /mcp/c/:key, /mcp/tools)
  routes/fran/pos/staff.get.ts   fran-pos roster-sync pull
app/             Nuxt UI (pages, components, layouts)
scripts/         migrate.mjs, seed.mjs
```

> Windows note: `core/` and `mcp/` are force-inlined in `nuxt.config.ts` (`nitro.externals.inline`, **absolute paths**) — otherwise Nitro externalises them and the emitted specifier loses its drive prefix (`C:\core\…`), 500-ing every route.

## Org model & accountability

Three separable layers, deliberately not collapsed:

**Functions** — Retail Ops, Marketing, People, Finance, Leadership.

**Positions (seats)** — the designed org. A seat holds the reporting line, a one-line `purpose`, planned `headcount`, and **two titles**:

| Field | Example | Used for |
|---|---|---|
| `title` | Store Supervisor | HR, payroll, grading, contracts |
| `comms_title` | Shift Captain | Everything a human reads |

`display_title` resolves for you (personal override → seat's comms title → formal title), so no caller has to choose. Seeded comms titles: Big Boss, Retail Queen, **Marketing Girlie**, People Person, Store Mum, Shift Captain, Glow Guide.

**Accountabilities** — the model you actually asked for. One rule: **exactly one accountable owner per outcome.** Each records the outcome (a promise, not an activity), the owner, a metric + target, a review cadence, and separately-tracked contributors (`contributor` / `consulted` / `informed`).

Ownership attaches to a **seat** by default so it survives turnover, with an optional person-level pin. The register resolves the seat to whoever holds it now, and reports honestly when it can't:

- seat vacant → `owner_resolved: false` with the reason
- seat shared by several holders → flagged, because a shared accountability is nobody's

That gap list is a first-class output (`?unowned=true`, or **Gaps only** on `/org`) — the seeded data has 4 gaps, all traceable to the two vacant HQ seats.

**Check-ins** record a period's metric value, status and note; the latest one drives the register's headline status. This is the hook for later meeting/scheduling tooling: reporting lines give 1:1 pairings, accountabilities give agenda items an owner, cadence + metric give a scorecard.

Hierarchy exists on both positions (designed) and staff (`reports_to_id`, actual) because they legitimately diverge — an explicit manager wins, else the seat's line is followed, and a vacant or multiply-held manager seat is surfaced rather than guessed.

Run `npm run db:seed:org` for the demo chart and register.

## Rostering: generate, import, export

Most rostering is expected to be **AI-driven from constraints**, with spreadsheets as the other on-ramp. Both routes land in the same place — a **draft** roster that still goes through the existing guardrails and a human publish step. Nothing here can publish.

### Generate from constraints

The division of labour is deliberate: an agent (or the UI grid) is good at turning "cover the weekend properly, Farah can't do Mondays, keep Erin under 44h" into a constraint object; it is bad at arithmetic over 40 slots. So **the agent owns the constraints and a deterministic assigner owns the filling** (`core/roster/generate.mjs`).

```jsonc
{ "coverage": [ { "weekday": "weekend", "blocks": [ { "template": "Opening", "count": 2 } ] } ],
  "rules": { "off_days_per_week": 1, "max_consecutive_days": 5, "weekly_ot_threshold_hours": 44 },
  "preferences": { "fair_weekend_rotation": true },
  "staff": { "must_work": { "SM001": ["mon"] }, "max_shifts": { "PT002": 3 } } }
```

`weekday` accepts `mon…sun` plus `daily` / `weekday` / `weekend`; blocks take a template name or explicit times. **Approved and pending leave, submitted availability and PT hour caps are hard limits whether or not you ask** — an agent should not re-encode them. Constraint sets are reusable and stored per store.

Output is a **proposal** (`roster_runs` row, no shifts written): a staff × day grid, hours per person, and **unmet slots with the reason each candidate was rejected** — which names the one constraint to relax. `roster_apply` then creates the draft.

### Import a spreadsheet

Mapped import, following fran-skums' `core/import/` doctrine (scored header detection, field catalog + alias table, unique headers) with two additions it lacks: **saved mappings** and a **real dry run**.

- Paste CSV **or tab-separated text** — a Sheets copy-paste is the intended input; no file upload needed.
- **Both layouts**: one row per shift, or a **staff × day grid** (what stores actually keep). Detected from the headers.
- Auto-maps columns by alias (*Emp No*, *Team Member*, *Dt*, *Duty*, *Station*…) with a confidence and a reason per guess.
- Resolves people by code or name (ambiguity reported, never guessed), dates in many shapes, shifts by template name / shorthand (`AM`, `PM`) / range, and treats `OFF` / `RD` / `X` / blank as days off.
- Dry run stages a batch with **per-row errors**; a bad row fails alone. Commit is idempotent and creates one draft per week the sheet covers.
- `save_mapping_as` remembers the mapping so a recurring upload needs no mapping step.

### Export (Sheets / Airtable / CSV)

One canonical row shape feeds every format, so what a manager sees in Sheets, what Airtable receives, and what the importer accepts are the same columns — an exported sheet can be hand-edited and re-imported.

`format=` `tsv` (paste into Sheets) · `grid_tsv` (staff × day matrix) · `airtable` (ready-to-POST records + field schema) · `csv` · `markdown` · `records`.

## Permissions

**Nothing about access is hardcoded.** Each workspace holds an editable role → permission matrix (`role_permissions`), plus per-person exceptions (`staff_permission_grants`) that can carry an expiry. Both the REST routes and the MCP scope derivation read the same resolver, so granting a supervisor "Publish rosters" changes the web app *and* makes the `roster_publish` tool appear in their Claude connection. Edit it at `/permissions` or via `POST /api/v1/permissions/matrix`.

Roles are `staff`, `supervisor`, `store_manager`, `area_manager`, `hq_admin` — labels for a starting set of permissions, not a hardcoded ladder.

Permissions (`domain:verb`): `staff:read/write` · `org:read/write` · `roster:read/write/publish` · `attendance:read/write` · `leave:read/write/approve` · `reports:read` · `reports:cost` (pay rates) · `payroll:lock` · `connector:manage` · `pos:sync`.
API-key packages: `mcp:safe`, `mcp:full`, `pos_connector`.

### Two layers, kept separate

1. **Permission** — what *kind* of action. `*:write` means "acts on other people"; self-service (own availability, own correction, own leave) runs on the matching `*:read` and needs no write permission. That is why the `staff` role has none.
2. **Identity** — *whose* records. `limitToSelf()` / `assertTeamReach()` in REST, `assertCanReadStaff()` / `assertManagerView()` in MCP. A permission never widens who you can look at.

Guardrail: `hq_admin` cannot have `staff:write` removed, since that is the permission required to edit the matrix — the API refuses with a 422 rather than allowing a lockout.

Every matrix and grant change is audited with who, what and why.

## REST API (`/api/v1/*`)

Auth: `Authorization: Bearer sk_live_…` / `X-API-Key` / session cookie. List responses: `{ data, total, limit, offset }`.

Key endpoints: `roster-intake/generate` · `roster-intake/apply` · `roster-intake/import` (`step=preview|commit`) · `roster-intake/mappings` · `constraint-sets` · `rosters/:id/export?format=…` · `permissions` (+`/matrix`, `/grants`) · `stores` · `staff` (CRUD) · `org/chart` · `org/positions` (GET/POST, cycle-checked) · `org/reporting` (seat, manager, reports, chain, accountabilities) · `accountabilities` (GET/POST, `?q=` search, `?unowned=true`) + `/:key/checkin` · `rosters` (+`/:id/publish` with guardrail warnings: leave clashes, PT caps, OT projection, missing rest days — 409 unless `force`) · `shifts` (CRUD) · `availability` (cutoff-enforced) · `swaps` (+`/:id/decide`) · `leave/types|balances|requests` (+decide) · `clock/qr` (daily rotating store QR) · `clock` (clock_in/out, break_start/end; adherence flags vs published shift) · `time-entries` (+ CSV `import` downtime fallback) · `corrections` (+decide, applies with full audit) · `flags` (+review) · `reports/hours` (per-staff OT breakdown or store summary; cost AM+ only) · `reports/attendance?format=csv` · `pay-periods` (+`/:id/lock` approve/lock/reopen).

## MCP

Deployed: **https://fran-hrm-lime.vercel.app** (connector URL `…/mcp`).

Agents connect and ask HR questions — *"how many hours did Farah work last week?"* → `hours_worked` returns the payroll-grade total (net of breaks) with per-week OT past the 44h MOM threshold. *"I forgot to clock out, what do I do?"* → `help_search` returns the current documented policy.

### Auth: per-user OAuth (preferred)

Claude stores one connector config per organisation, so an API key in the URL would give every employee identical power. OAuth fixes that — the shared client id/secret only identifies Claude; the credential that grants access is a token minted **per staff member** after they sign in with their employee code + PIN.

1. HQ admin generates credentials in **Manage → Connect Claude** (`POST /api/v1/mcp-connector/client`), and sends staff an invite link (`/oauth/connect?invite=…`).
2. Staff add the connector URL, paste the client id/secret under Claude's Advanced settings, click **Connect**.
3. They land on `/oauth/authorize`, sign in, and see exactly which account and how many tools before approving.

**Scopes are never frozen on the token.** Every request re-derives them from the staff member's live role, so a demotion or termination cuts Claude's access on the next message. Role → power:

Tool availability follows the **editable permission matrix** (see Permissions above), so it is per-workspace rather than fixed. With the shipped defaults: staff ~25 tools (own records only), supervisor ~25 + team reads and corrections, store_manager ~26 + publish and leave approval, area_manager/hq_admin ~27 + staff records and cost reporting.

Rank-and-file staff naming a colleague get a permission error, not their data — enforced in the tool layer (`assertCanReadStaff`), matching the REST API's `limitToSelf`.

Flow endpoints: `/.well-known/oauth-protected-resource[/mcp]`, `/.well-known/oauth-authorization-server[/mcp]`, `/oauth/authorize` (consent page), `/oauth/token`. PKCE S256 required, codes single-use with 60s TTL, access 1h, refresh 60d rotated on every use. DCR is deliberately unsupported.

### Auth: API key (headless)

`POST /mcp` with `Authorization: Bearer sk_live_…`, `?api_key=…`, or `/mcp/c/sk_live_…`. For scripts and service integrations; no staff identity, so scopes are the only gate.

### stdio (Claude Desktop / Cursor / Claude Code)

```json
{
  "mcpServers": {
    "fran-hrm": {
      "command": "node",
      "args": ["C:/Users/Jeremy Tan/CodeProjects/fran-hrm/mcp/src/index.mjs"],
      "env": {
        "FRAN_HRM_MCP_WORKSPACE_ID": "11111111-1111-4111-8111-000000000001",
        "FRAN_HRM_MCP_PROFILE": "safe"
      }
    }
  }
}
```

### Tools (35)

`capabilities` · `help_search` / `help_get` / `help_list` (no scope — anyone may ask how things work) · **`roster_planning_context`** / **`roster_generate`** / **`roster_apply`** / **`roster_export`** / **`roster_import_preview`** / **`roster_import_commit`** / **`constraint_set_list`** / **`constraint_set_save`** · `stores_list` · `staff_search` / `staff_get` · **`org_chart`** · **`org_reporting`** · **`who_owns`** · **`accountability_list`** / **`accountability_get`** · `hours_worked` · `attendance_summary` · `time_entries_list` · `attendance_flags_list` · `roster_get` · `shifts_list` · `availability_list` · `swaps_list` · `leave_types_list` · `leave_balance_get` · `leave_requests_list` · `leave_request_create` (write) · `shift_assign` + `roster_publish` + **`accountability_checkin`** (privileged).

`who_owns` is the one to reach for on any "who is responsible for…" question — the agent instructions tell it that **a title is not an accountability**, so it looks up the register instead of pattern-matching job titles.

All mutations audit to `audit_events` with `source_type='mcp'` and, for OAuth callers, `actor_id` set to the real staff member — so "who asked Claude to do this" is answerable.

## Help centre

`docs/help/*.md` is the **source of truth** (frontmatter + markdown), synced into `help_articles` by `npm run help:sync`. The `/help` UI and the `help_search` MCP tool both read the DB copy, so a lost user gets current policy from either surface.

Ranking is deterministic (`core/help/resolve.mjs`) — token scoring plus per-intent boosts — so adding an `intent_tags` entry provably fixes a specific question.

**When you change behaviour, update the matching article in the same commit.** `npm run help:check` fails if the DB and the files have drifted; wire it into CI or the deploy step.

## fran-pos sync contract

`GET /fran/pos/staff` (scope `pos:sync`) returns rows shaped for fran-pos's `upsert_pos_staff_from_source` RPC: `source_provider='fran-hrm'`, `external_subject_id = staff.id`, HRM roles mapped to POS roles (`hq_admin/area_manager→admin`, `store_manager/supervisor→manager`, `staff→cashier`). Termination propagates `employment_status` so POS auto-revokes register access; POS never auto-re-enables (local POS authority).
