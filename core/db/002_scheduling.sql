-- FranHRM scheduling: shift templates, rosters (draft/publish), shifts,
-- availability, shift swaps.
--
-- Draft/publish doctrine: SM builds a draft; only the published version is
-- visible to staff and used for T&A comparison. Publishing bumps version and
-- snapshots publish metadata; guardrail warnings (OT, rest days, leave
-- clashes, PT caps) are computed at publish time in the API layer.

create table public.shift_templates (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  store_id uuid references public.stores(id) on delete cascade, -- null = shared across stores
  name text not null,
  start_time time not null,
  end_time time not null,
  break_minutes integer not null default 60,
  job_code text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create type public.roster_status as enum ('draft', 'published');

create table public.rosters (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  week_start date not null, -- always a Monday; enforced in API
  status public.roster_status not null default 'draft',
  version integer not null default 1,
  published_at timestamptz,
  published_by uuid references public.staff(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (store_id, week_start)
);

create type public.shift_status as enum ('scheduled', 'cancelled');

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  roster_id uuid not null references public.rosters(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  -- null staff_id = open shift still to be filled from the PT pool
  staff_id uuid references public.staff(id) on delete set null,
  work_date date not null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  break_minutes integer not null default 0,
  job_code text,
  template_id uuid references public.shift_templates(id) on delete set null,
  status public.shift_status not null default 'scheduled',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_at > start_at)
);

create index shifts_roster_idx on public.shifts (roster_id);
create index shifts_staff_date_idx on public.shifts (staff_id, work_date);
create index shifts_store_date_idx on public.shifts (store_id, work_date);

-- Availability is per concrete date (not weekday patterns) so cutoffs and
-- exceptions stay trivial. Multiple windows per day are allowed.
create table public.availability (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  work_date date not null,
  kind text not null default 'available' check (kind in ('available', 'preferred', 'unavailable')),
  start_time time, -- null = whole day
  end_time time,
  note text,
  submitted_at timestamptz not null default now()
);

create index availability_staff_date_idx on public.availability (staff_id, work_date);
create index availability_date_idx on public.availability (workspace_id, work_date);

create type public.swap_status as enum ('pending', 'approved', 'rejected', 'cancelled');

-- Staff-initiated swap: requester gives up shift_id; optionally takes the
-- counterpart's shift in return (counterpart_shift_id). Supervisor/SM decides.
create table public.shift_swaps (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  shift_id uuid not null references public.shifts(id) on delete cascade,
  requested_by uuid not null references public.staff(id) on delete cascade,
  counterpart_staff_id uuid not null references public.staff(id) on delete cascade,
  counterpart_shift_id uuid references public.shifts(id) on delete set null,
  reason text,
  status public.swap_status not null default 'pending',
  decided_by uuid references public.staff(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create index shift_swaps_status_idx on public.shift_swaps (workspace_id, status);

alter table public.shift_templates enable row level security;
alter table public.rosters enable row level security;
alter table public.shifts enable row level security;
alter table public.availability enable row level security;
alter table public.shift_swaps enable row level security;
