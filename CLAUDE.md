# FranHRM — agent notes

## Architecture
- **Shared logic lives in `core/*.mjs`** and is imported by BOTH `server/api/v1/*` routes and `mcp/src/tools.mjs`. Change behaviour there, not in a route.
- `core/` and `mcp/` must stay in `nuxt.config.ts` → `nitro.externals.inline` with **absolute paths** (Windows drive-prefix bug; relative entries don't match).
- DB: service-role only, RLS on with zero policies. Every query MUST filter `workspace_id`. Migrations: `core/db/NNN_*.sql`, run `npm run db:migrate` (checksummed — never edit an applied file, add a new one).
- Money is integer cents. Dates `YYYY-MM-DD` (SGT calendar dates), times timestamptz. Weeks start Monday; `roster.week_start` is always a Monday.
- Mutations write `audit_events` via `core/audit/record.mjs` (before/after, never throws).
- Payroll lock: mutations on locked dates must call `assertNotLocked()`.
- SSR: session-dependent fetches use `useRequestFetch()`, not `$fetch` — plain `$fetch` drops cookies server-side and bounces authenticated users to /login.

## Design
Desktop-web-first. Sidebar (`AppSidebar.vue`) + topbar in `layouts/default.vue`; `lg:` is the primary breakpoint, mobile is the fallback. Use `UiPageHeader`, `UiTable`, `UiStat` for new pages — prefer dense tables over cards for anything enumerable. Palette rules: warm cream page, brown ink (never grey/black), yellow only for action/selection, brown low-opacity shadows, tinted cards sit flat while white ones float.

## Permissions — two layers, keep them in step
1. **Permission (scope)** — what KIND of action. Comes from the **editable matrix** in `role_permissions` (+ `staff_permission_grants` overrides), resolved by `core/permissions/resolve.mjs`. API keys carry their own scopes. Tools declare theirs in `mcp/src/toolScopes.mjs` and re-check via `requireScope()`.
2. **Actor identity** — WHOSE records. `limitToSelf()` / `assertTeamReach()` in REST; `assertCanReadStaff()` / `assertManagerView()` in MCP tools.

Adding a route or tool that touches personal records? It needs BOTH. A scope check alone let a part-timer read a colleague's hours (fixed 2026-08-07) — scopes say *what kind* of data, identity says *whose*.

**Never reintroduce a hardcoded role floor.** `minRole` exists on `requireActor` but should stay unused for capability checks — the whole point of the matrix is that "let this supervisor publish" is a config change, not a deploy. Use `ctx.has('scope')` rather than comparing roles.

`*:write` means "acts on other people". Self-service (own availability, own correction request, own leave) runs on the matching `*:read` plus the identity check, which is why the `staff` role holds no write permissions (migration 010). Don't "fix" a staff 403 by granting them a write scope — check the route is using the read scope + identity instead.

Both the web app and MCP resolve through the same functions, so a matrix edit changes Claude's tool list on the next message. Invalidate with `invalidatePermissionCache(workspaceId)` after writing (the resolver caches 60s). Scopes are never stored on an OAuth token — that is what makes demotion and termination take effect immediately.

## Org & accountability model
- **Two title forms everywhere.** `positions.title` is internal/formal (payroll, contracts); `positions.comms_title` is what we say out loud ("Marketing Girlie"). `staff.comms_title` overrides per person. Every projection returns `display_title` — use it for anything human-facing and never mix the two registers in one sentence.
- **Hierarchy is on seats AND staff, on purpose.** `positions.reports_to_id` is the designed org; `staff.reports_to_id` is an explicit override for interim arrangements. `resolveManager()` prefers the override, then the seat's line. A vacant or multiply-held manager seat is REPORTED, never guessed — a wrong answer here pairs the wrong people in a 1:1.
- **One accountable owner per accountability.** Owner attaches to a seat (survives turnover) with an optional `owner_staff_id` pin; the DB constraint refuses a row with neither. `resolveOwner()` returns `owner_resolved: false` plus a reason when the seat is vacant or shared — do not "helpfully" fall back to a contributor or a manager. That gap list is the feature.
- Reporting-line edits must go through `wouldCreateCycle()`; a loop makes the chart and every manager query unresolvable.
- Contributors (`contributor` / `consulted` / `informed`) are a separate table from the owner. Keep it that way — collapsing them is how accountability becomes plural and therefore nobody's.
- Check-ins drive the register's headline status (latest wins). Both the REST endpoint and the MCP tool apply that rule; keep them in step.

## Rostering intake (generate / import / export)
- **The agent supplies constraints; `core/roster/generate.mjs` does the assignment.** Never hand-place shifts one by one from an LLM — that is how hour counts and PT caps drift. If generation gets the wrong answer, fix the constraints and re-run (it writes nothing).
- Leave, availability and PT caps are enforced inside the generator. Do not re-encode them in constraints, and do not add a second layer of checking around it.
- **Unmet slots are a feature, not a failure.** Each carries the rejection reason per candidate, which is what tells a manager which constraint to relax. Never silently under-staff or drop them.
- Generation and import both produce a **draft** via `roster_runs` → `applyRun`. Nothing in `core/roster/intake.mjs` may publish; that stays a human action behind `roster:publish`.
- `core/import/` is dependency-free `.mjs` (parse → map → roster), same split as fran-skums. Field catalog and alias table live in `core/import/fields.mjs` — add aliases there rather than special-casing a sheet.
- Canonical mapping is **field → header**; `toColumnView`/`fromColumnView` flip it for the per-column UI. Two layouts: `rows` and `grid` (staff × date columns). `detectLayout` always returns `date_columns` even when it decides `rows`, because a forced/saved `grid` layout needs them (fixed 2026-08-08).
- `EXPORT_COLUMNS` in `core/roster/export.mjs` is a **round-trip contract**: the rows export re-imports cleanly. Changing a label breaks that — add a column rather than renaming one.
- Bulk shift insert falls back to per-row on failure so one bad shift doesn't lose the week and the error names the row.

## Help centre — update it with the code
`docs/help/*.md` is the source of truth; `npm run help:sync` upserts into `help_articles`; `npm run help:check` fails on drift. The `help_search` MCP tool answers staff policy questions from this content, so **stale docs become wrong answers about someone's pay or leave**. When you change behaviour (a threshold, a cutoff, a workflow step), edit the matching article in the same commit. Adding a new user-facing capability means adding an article, with `intent_tags` covering how a confused person would actually phrase it.

## Conventions
- MCP tool changes: update `toolDefinitions` + `handleTool` in `mcp/src/tools.mjs` AND the scope catalog in `mcp/src/toolScopes.mjs` (double gate).
- Error messages on agent-facing surfaces are long and actionable — name the exact screen, scope or env var that fixes the problem.
- `npm run db:seed` is idempotent (deterministic UUIDs); demo PIN 123456.
- Deployed on Vercel as `wytanjs-projects/fran-hrm` → https://fran-hrm-lime.vercel.app (`fran-hrm.vercel.app` was taken). `MCP_OAUTH_ISSUER` must match the public origin exactly or Claude's resource check fails.
