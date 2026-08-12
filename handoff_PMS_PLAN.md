# Handoff — PMS (Property Management Solution)

**Status:** planned, not started. This is the pickup brief for building PMS as its own system later.
**As of:** 2026-08-12

## Why PMS exists

Fran is opening ~5 Singapore stores in a year. Property/facilities is a real, standing domain that no existing system owns — **renovation projects & schedules, taxation, insurance, leases, and floor-plan/layout assets**. It is not HR (people), not inventory (stock), not POS (sales), so it gets its own system rather than being bolted onto one.

## Store ownership — the decision

The same physical store is projected by each system for its own domain, aligned by a shared `code`. Decisions:

| Concern | Owner | Notes |
|---|---|---|
| **Simple store master** (id, code, name, address, tz, active) | **fran-skums** | Already models stores as `inventory_locations` (type `store`) + `pos_locations`. Expose a simple store read API; skums is the source of truth for "a store exists". |
| Staff / rostering / attendance / **zones** | **fran-hrm** | HRM **retrieves stores from skums** for zone management (transition off its own `stores` table). Zones stay in HRM (they drive wage/performance). |
| Inventory / replenishment | **fran-skums** | Unchanged. |
| Sales / registers | **fran-pos** | Unchanged. |
| **Property / facilities** (renovation, tax, insurance, lease, floor-plan asset) | **PMS (new)** | Keys property records to the store `code` from skums. |

Net: **skums = store master**, HRM/PMS/POS read stores from it via HTTP + API key. PMS owns everything *about the property* of a store.

## Architecture (follow the Fran doctrine)

- **Own repo + own Supabase project** (~$10/mo). No shared database with any other system — integration is **HTTP + scoped API key** only (`sk_live_`, sha256-stored), same as the rest of the stack.
- Reuse the shared conventions from fran-skums/fran-hrm: `core/*.mjs` domain layer imported by both `/api/v1` routes and an MCP tool layer; numbered checksummed SQL migrations in `core/db/NNN_*.sql`; service-role client, RLS-on/zero-policies, every query filtered by `workspace_id`; money in integer cents; SGT calendar dates.
- **Floor-plan/layout images → Supabase Storage** (object storage bucket), not base64 in a column. (HRM currently stores layout images as data URLs in `store_layouts.image_data_url` — a stopgap; the layout *asset* should migrate to PMS Storage, with HRM referencing it.)

## Data model sketch

- `stores_cache` — thin mirror of skums stores (code, name), synced via skums API. Or resolve on the fly; cache for offline.
- `properties` — one per store: `store_code`, address/unit/postal, floor_area_sqm, lease_start/end, landlord, monthly_rent_cents, status.
- `renovation_projects` — `property_id`, title, scope, contractor, budget_cents, start/target/actual dates, status; `renovation_milestones`.
- `insurance_policies` — `property_id`, insurer, policy_no, type (fire/public-liability/…), coverage_cents, premium_cents, start/expiry, document.
- `tax_records` — `property_id`, type (property tax/GST/…), period, amount_cents, due/paid dates, document.
- `documents` — polymorphic attachments (lease PDFs, permits, floor plans) → Supabase Storage keys.
- `floor_plans` — `property_id`, storage_key, source (pdf/image), version. (HRM zones reference this later.)

## Integration points

- **PMS → skums**: read the store list/detail (source of truth).
- **HRM → skums**: read stores for zones (replaces HRM's local `stores`). HRM zones key on store `code`.
- **HRM ↔ PMS (later)**: HRM zones can reference a PMS `floor_plan` so the layout asset lives once (in PMS) and HRM overlays zones for scheduling/wage/performance.
- Later: VLM/retail-analytics read the floor plan + zones for space utilisation.

## Use cases (v1 target)

Upload renovation information & schedule; track taxation; track insurance (policies + expiry reminders); store lease/permit documents; hold the store floor-plan asset. Scheduled-renovation reminders and expiry alerts are natural cron/notification additions.

## Non-goals / phasing

- v1 is CRUD + documents + reminders. No accounting engine (feed figures to finance/EOR instead).
- VLM auto-zoning and analytics stay in the HRM/analytics track.
- Keep PMS thin: it owns property records and documents, not HR/inventory/sales.

## Handoff checklist

1. New repo `fran-pms` + new Supabase project; copy the skums/hrm scaffolding (migrations runner, service-role client, `core/*.mjs` + `/api/v1` + MCP split, auth).
2. Store read client against skums (API key).
3. Migrations for the tables above; Supabase Storage bucket for documents/floor plans.
4. Dashboard: properties list → property detail (renovation / insurance / tax / documents / floor plan).
5. Decide store-master transition for HRM (point HRM at skums stores; migrate `store_layouts`/zones to reference PMS floor plans).

## Open questions

- Does skums's `inventory_locations`/`pos_locations` need a dedicated "retail store" projection + public read API, or is `location_type = 'store'` enough?
- One workspace/tenant model shared across the stack, or per-system workspace ids aligned by code (current reality)?
- Multi-country (MY next): properties are per-country; PMS should not hardcode SG (tax/insurance regimes differ).
