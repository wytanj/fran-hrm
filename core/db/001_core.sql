-- FranHRM core: workspaces, stores, staff, sessions, API keys, audit.
--
-- FranHRM owns the staff master record for the whole Fran stack. fran-pos
-- consumes it via the roster-sync contract (source_provider='fran-hrm',
-- external_subject_id = staff.id). Each Fran system runs its own Supabase
-- project; integration is HTTP + API key, never shared tables.
--
-- RLS posture: the app talks to Postgres exclusively through the service
-- key (staff log in with employee code + PIN, not Supabase Auth), so every
-- table gets RLS enabled with ZERO policies — service role only. Tenancy is
-- enforced in code by always filtering on workspace_id.

create extension if not exists pgcrypto;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  -- Operational knobs live here rather than as columns so tuning them never
  -- needs a migration: grace_minutes, ot_weekly_threshold_hours,
  -- ot_daily_threshold_hours, availability_cutoff_days, swap_cutoff_hours,
  -- default currency etc.
  settings jsonb not null default '{
    "grace_minutes": 5,
    "ot_weekly_threshold_hours": 44,
    "ot_daily_threshold_hours": 12,
    "availability_cutoff_days": 7,
    "swap_cutoff_hours": 24,
    "off_days_per_week": 1
  }'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type public.staff_role as enum ('staff', 'supervisor', 'store_manager', 'area_manager', 'hq_admin');
create type public.employment_type as enum ('full_time', 'part_time');

create table public.stores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null,
  name text not null,
  kind text not null default 'store' check (kind in ('store', 'hq')),
  address text,
  phone text,
  timezone text not null default 'Asia/Singapore',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, code)
);

create table public.staff (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  employee_code text not null,
  display_name text not null,
  email text,
  phone text,
  role public.staff_role not null default 'staff',
  employment_type public.employment_type not null default 'full_time',
  employment_status text not null default 'active' check (employment_status in ('active', 'inactive', 'terminated')),
  home_store_id uuid references public.stores(id) on delete set null,
  -- PT economics. Rate is cents to avoid float money; visible to area_manager+ only.
  hourly_rate_cents integer,
  pt_weekly_hour_cap numeric(5,2),
  pt_monthly_hour_cap numeric(6,2),
  hired_on date,
  terminated_on date,
  -- Web/app login credential (bcrypt). Decoupled from POS passcodes on purpose:
  -- POS keeps local authority over register access.
  pin_hash text,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  pos_access_enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, employee_code)
);

create index staff_workspace_idx on public.staff (workspace_id, employment_status);

-- A staff member can work at several stores (cross-store PT pool); primary
-- assignment drives default filters in the UI.
create table public.staff_store_assignments (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (staff_id, store_id)
);

create table public.staff_sessions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  token_hash text not null unique,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  ended_at timestamptz
);

create index staff_sessions_staff_idx on public.staff_sessions (staff_id);

-- API keys for headless clients: MCP connectors, fran-pos pulling the staff
-- directory, report exporters. sha256(key) stored, plaintext shown once.
create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default '{}',
  is_active boolean not null default true,
  revoked_at timestamptz,
  expires_at timestamptz,
  last_used_at timestamptz,
  usage_count integer not null default 0,
  created_by uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Single append-only audit stream. Timesheet spec: "every correction,
-- override, approval and adjustment is logged with the user's ID/name,
-- date-time stamp, and before/after values."
create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  actor_kind text not null default 'user' check (actor_kind in ('user', 'agent', 'system')),
  actor_id uuid,
  actor_name text,
  source_type text not null default 'web' check (source_type in ('web', 'api', 'mcp', 'system')),
  object_type text not null,
  entity_id uuid,
  operation text not null,
  before_data jsonb,
  after_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_entity_idx on public.audit_events (workspace_id, object_type, entity_id);
create index audit_events_created_idx on public.audit_events (workspace_id, created_at desc);

alter table public.workspaces enable row level security;
alter table public.stores enable row level security;
alter table public.staff enable row level security;
alter table public.staff_store_assignments enable row level security;
alter table public.staff_sessions enable row level security;
alter table public.api_keys enable row level security;
alter table public.audit_events enable row level security;
