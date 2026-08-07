-- 011 — Roster intake: constraint sets, generation runs, and mapped imports.
--
-- Two ways a roster arrives, and both land in the same place (a DRAFT roster
-- that still goes through the existing guardrails and publish step):
--
--   1. GENERATED from constraints. Most rostering will be AI-driven: an agent
--      supplies the shape of the week (coverage per day, rules, preferences)
--      and we turn that into shifts. The constraint set is stored so a run is
--      reproducible, explainable and re-runnable after a tweak — "why am I on
--      Saturday?" has an answer.
--
--   2. IMPORTED from a spreadsheet someone already keeps. Every store has its
--      own column names, so the import is MAPPED rather than fixed-format:
--      upload → we guess the mapping → the user confirms → dry-run preview →
--      commit. Confirmed mappings are saved per source so the next upload of
--      the same sheet needs no thinking.
--
-- Nothing here writes a published roster. Generation and import both produce a
-- draft, because a human accepting responsibility for the week is the point of
-- the publish step.

-- ---------------------------------------------------------------------------
-- Constraint sets — the input to generation, reusable week to week.
-- ---------------------------------------------------------------------------
create table public.roster_constraint_sets (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  store_id     uuid references public.stores(id) on delete cascade,
  name         text not null,
  description  text,
  -- The constraints themselves. jsonb because this is a spec that will grow,
  -- and because an agent supplies it wholesale rather than field by field.
  -- Shape (all optional, validated in core/roster/constraints.mjs):
  --   {
  --     "coverage": [                       // per weekday, who is needed when
  --       { "weekday": "mon", "blocks": [
  --           { "template": "Opening", "count": 2, "job_code": "sales_floor" },
  --           { "start": "12:00", "end": "21:00", "count": 1 }
  --       ]}
  --     ],
  --     "rules": {
  --       "max_consecutive_days": 5,
  --       "min_rest_hours_between_shifts": 10,
  --       "off_days_per_week": 1,
  --       "respect_availability": true,     // hard by default
  --       "respect_leave": true,            // always hard, listed for clarity
  --       "respect_pt_caps": true,
  --       "weekly_ot_threshold_hours": 44,
  --       "max_hours_per_day": 12
  --     },
  --     "preferences": {
  --       "fair_weekend_rotation": true,
  --       "prefer_preferred_availability": true,
  --       "keep_pairs": [["ST001","PT001"]], // people who work well together
  --       "avoid_pairs": []
  --     },
  --     "staff": {                           // optional narrowing
  --       "include": ["SM001","SV001"], "exclude": [],
  --       "must_work": { "SM001": ["mon","tue"] },
  --       "max_shifts": { "PT002": 3 }
  --     }
  --   }
  constraints  jsonb not null default '{}'::jsonb,
  is_default   boolean not null default false,
  created_by   uuid references public.staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, store_id, name)
);

create index roster_constraint_sets_store_idx on public.roster_constraint_sets (workspace_id, store_id);

-- ---------------------------------------------------------------------------
-- Generation runs — one row per attempt, kept for explainability.
-- ---------------------------------------------------------------------------
create type public.roster_run_status as enum ('proposed', 'applied', 'discarded', 'failed');
create type public.roster_run_source as enum ('generated', 'imported', 'copied');

create table public.roster_runs (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  store_id      uuid not null references public.stores(id) on delete cascade,
  week_start    date not null,
  source        public.roster_run_source not null default 'generated',
  status        public.roster_run_status not null default 'proposed',
  constraint_set_id uuid references public.roster_constraint_sets(id) on delete set null,
  -- Snapshot of the constraints actually used, so editing the set later does
  -- not rewrite the history of why this week looks the way it does.
  constraints_used jsonb not null default '{}'::jsonb,
  -- The proposed shifts before they become rows, plus per-shift reasoning.
  proposal      jsonb not null default '[]'::jsonb,
  -- What could not be satisfied. An honest generator reports gaps rather than
  -- quietly under-staffing a day.
  unmet         jsonb not null default '[]'::jsonb,
  warnings      jsonb not null default '[]'::jsonb,
  -- Who/what produced it: 'claude', 'web', an API key name.
  generated_by_kind text not null default 'user' check (generated_by_kind in ('user', 'agent', 'system')),
  generated_by  uuid references public.staff(id) on delete set null,
  generator     text,
  roster_id     uuid references public.rosters(id) on delete set null,
  applied_at    timestamptz,
  created_at    timestamptz not null default now()
);

create index roster_runs_week_idx on public.roster_runs (workspace_id, store_id, week_start desc);

-- ---------------------------------------------------------------------------
-- Import mappings — remembered per named source ("Orchard Google Sheet").
-- ---------------------------------------------------------------------------
create table public.roster_import_mappings (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  store_id     uuid references public.stores(id) on delete set null,
  name         text not null,
  -- { "field": "source column header" } — the confirmed column mapping.
  mapping      jsonb not null default '{}'::jsonb,
  -- Layout hint: 'rows' = one row per shift; 'grid' = staff rows × day columns
  -- (what most stores actually keep in Sheets).
  layout       text not null default 'rows' check (layout in ('rows', 'grid')),
  -- Value translations the sheet uses: { "OFF": null, "AM": "Opening" }.
  value_aliases jsonb not null default '{}'::jsonb,
  options      jsonb not null default '{}'::jsonb,
  last_used_at timestamptz,
  use_count    integer not null default 0,
  created_by   uuid references public.staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (workspace_id, name)
);

-- ---------------------------------------------------------------------------
-- Import batches — a dry run and its commit, with per-row results.
-- ---------------------------------------------------------------------------
create type public.import_batch_status as enum ('preview', 'committed', 'failed', 'discarded');

create table public.roster_import_batches (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  store_id     uuid references public.stores(id) on delete set null,
  week_start   date,
  mapping_id   uuid references public.roster_import_mappings(id) on delete set null,
  mapping_used jsonb not null default '{}'::jsonb,
  layout       text,
  source_name  text,
  -- Detected headers and a few sample rows, so a preview can be re-rendered
  -- without re-uploading.
  headers      text[] not null default '{}',
  row_count    integer not null default 0,
  -- Normalised rows + per-row errors from the dry run.
  preview      jsonb not null default '[]'::jsonb,
  errors       jsonb not null default '[]'::jsonb,
  status       public.import_batch_status not null default 'preview',
  roster_id    uuid references public.rosters(id) on delete set null,
  imported_count integer not null default 0,
  -- Same idempotency doctrine as the POS outbox: a retried commit must not
  -- double-book a week.
  idempotency_key text,
  created_by   uuid references public.staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  committed_at timestamptz,
  unique (workspace_id, idempotency_key)
);

create index roster_import_batches_status_idx on public.roster_import_batches (workspace_id, status, created_at desc);

alter table public.roster_constraint_sets enable row level security;
alter table public.roster_runs enable row level security;
alter table public.roster_import_mappings enable row level security;
alter table public.roster_import_batches enable row level security;

comment on table public.roster_constraint_sets is
  'Reusable rostering constraints (coverage, rules, preferences). The input an AI generator works from.';
comment on table public.roster_runs is
  'One generation/import attempt: constraints used, proposed shifts, and what could not be satisfied. Kept for explainability.';
comment on table public.roster_import_mappings is
  'Saved column mappings per spreadsheet source, so a recurring upload needs mapping only once.';
