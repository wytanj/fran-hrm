-- 033 — Hire gates, payroll_eligible_from, HQ store-cover pay bucket.
-- QR/clock time_entries remain SoT for hours. Roster is plan only.
-- HQ cover convention: time_entries.job_code = 'hq_store_cover' → Additional Wages.

alter table public.staff
  add column if not exists payroll_eligible_from date;

comment on column public.staff.payroll_eligible_from is
  'First date this person may earn ordinary wages. Before this (and before hire gates complete), earnings OW = 0. Backfilled from hired_on for existing active staff.';

update public.staff
set payroll_eligible_from = hired_on
where payroll_eligible_from is null and hired_on is not null;

create table if not exists public.staff_hire_gates (
  staff_id uuid primary key references public.staff(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  offer_accepted_on date,
  docs_verified_on date,
  nric_verified_on date,
  start_on date,
  first_store_presence_on date,
  payroll_eligible_from date,
  notes text,
  updated_by uuid references public.staff(id) on delete set null,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists staff_hire_gates_ws_idx
  on public.staff_hire_gates (workspace_id);

alter table public.staff_hire_gates enable row level security;

comment on table public.staff_hire_gates is
  'Hire lifecycle gates (offer → docs/NRIC → start → first QR store presence). Payroll refuses OW until payroll_eligible_from.';

do $$ begin
  comment on column public.time_entries.job_code is
    'Optional job/pay tag. Use hq_store_cover for HQ FT working a store shift (counts as Additional Wages, not more OW).';
exception when undefined_column then null;
end $$;
