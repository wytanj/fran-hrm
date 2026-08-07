-- FranHRM time & attendance: rotating QR tokens, raw clock events, derived
-- time entries, correction workflow, adherence/OT flags, payroll lock.
--
-- Two-layer design: clock_events is the immutable raw stream (never edited,
-- corrections append new events with method='correction'); time_entries is
-- the derived one-row-per-staff-per-day working record that reports and the
-- hours computation read. Original values are always recoverable from the
-- event stream + audit_events.

-- Daily rotating QR per store. Staff scan the store QR to clock; token
-- validity is (store, date). Get-or-create on demand.
create table public.qr_tokens (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  valid_on date not null,
  token text not null unique,
  created_at timestamptz not null default now(),
  unique (store_id, valid_on)
);

create type public.clock_event_type as enum ('clock_in', 'clock_out', 'break_start', 'break_end');
create type public.clock_method as enum ('qr', 'manual', 'import', 'correction');

create table public.clock_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  type public.clock_event_type not null,
  at timestamptz not null default now(),
  method public.clock_method not null default 'qr',
  qr_token_id uuid references public.qr_tokens(id) on delete set null,
  device_id text,
  recorded_by uuid references public.staff(id) on delete set null, -- who keyed it (manual/import/correction)
  note text,
  created_at timestamptz not null default now()
);

create index clock_events_staff_idx on public.clock_events (staff_id, at);

create table public.time_entries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  store_id uuid not null references public.stores(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  shift_id uuid references public.shifts(id) on delete set null,
  work_date date not null,
  clock_in_at timestamptz,
  clock_out_at timestamptz,
  break_minutes integer not null default 0,
  break_open_at timestamptz, -- set while a break is running
  job_code text,
  source text not null default 'clock' check (source in ('clock', 'import', 'manual', 'correction')),
  status text not null default 'open' check (status in ('open', 'closed', 'approved', 'locked')),
  locked_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index time_entries_staff_date_idx on public.time_entries (staff_id, work_date);
create index time_entries_store_date_idx on public.time_entries (store_id, work_date);

create type public.correction_status as enum ('pending', 'approved', 'rejected');

-- Staff flags a missed/wrong clock; supervisor/SM approves. Applying an
-- approved correction updates time_entries, appends a clock_event
-- (method='correction') and writes an audit_events row with before/after.
create table public.time_corrections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  time_entry_id uuid references public.time_entries(id) on delete set null,
  staff_id uuid not null references public.staff(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  work_date date not null,
  field text not null check (field in ('clock_in_at', 'clock_out_at', 'break_minutes', 'add_entry')),
  old_value text,
  new_value text not null,
  reason text,
  status public.correction_status not null default 'pending',
  requested_by uuid not null references public.staff(id) on delete cascade,
  decided_by uuid references public.staff(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

create index time_corrections_status_idx on public.time_corrections (workspace_id, status);

-- Schedule-adherence and compliance flags, computed on clock events and by
-- the flags sweep: late | early_in | early_out | late_out | no_show |
-- missed_clock_out | unscheduled | ot_daily | ot_weekly | no_off_day
create table public.attendance_flags (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  store_id uuid references public.stores(id) on delete set null,
  shift_id uuid references public.shifts(id) on delete set null,
  time_entry_id uuid references public.time_entries(id) on delete set null,
  work_date date not null,
  flag_type text not null,
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'reviewed')),
  reviewed_by uuid references public.staff(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);

create index attendance_flags_staff_idx on public.attendance_flags (staff_id, work_date);
create index attendance_flags_open_idx on public.attendance_flags (workspace_id, status, work_date);

-- Payroll lock: once a period is approved + exported, entries lock read-only.
-- Reopening requires hq_admin/area_manager and is audited; late corrections
-- post as dated adjustments in the next period instead of in-place edits.
create table public.pay_periods (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open', 'approved', 'locked')),
  approved_by uuid references public.staff(id) on delete set null,
  approved_at timestamptz,
  locked_by uuid references public.staff(id) on delete set null,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, start_date, end_date),
  check (end_date >= start_date)
);

alter table public.qr_tokens enable row level security;
alter table public.clock_events enable row level security;
alter table public.time_entries enable row level security;
alter table public.time_corrections enable row level security;
alter table public.attendance_flags enable row level security;
alter table public.pay_periods enable row level security;
