-- FranHRM leave: configurable types, per-year balances, request workflow.
-- Approved (and pending) leave blocks roster slots — enforced at shift
-- create/publish time in the API layer, surfaced as guardrail warnings.

create table public.leave_types (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  code text not null,
  name text not null,
  is_paid boolean not null default true,
  default_days_per_year numeric(5,2) not null default 0,
  requires_attachment boolean not null default false, -- e.g. MC
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (workspace_id, code)
);

create table public.leave_balances (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete cascade,
  year integer not null,
  entitled_days numeric(5,2) not null default 0,
  used_days numeric(5,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, leave_type_id, year)
);

create type public.leave_status as enum ('pending', 'approved', 'rejected', 'cancelled');

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  leave_type_id uuid not null references public.leave_types(id) on delete restrict,
  start_date date not null,
  end_date date not null,
  days numeric(5,2) not null,
  half_day boolean not null default false,
  reason text,
  status public.leave_status not null default 'pending',
  decided_by uuid references public.staff(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index leave_requests_staff_idx on public.leave_requests (staff_id, start_date);
create index leave_requests_status_idx on public.leave_requests (workspace_id, status);

alter table public.leave_types enable row level security;
alter table public.leave_balances enable row level security;
alter table public.leave_requests enable row level security;
