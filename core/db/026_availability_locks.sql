-- 026 — Manager-set availability locks, independent of the automatic cutoff.
--
-- A lock is per (staff_id, work_date) and must be settable even when the staff
-- member has not submitted an availability row for that date — so this is a
-- new table, not a column on availability. Staff self-service POSTs are
-- blocked; roster:write callers can still edit through a lock.

create table public.availability_locks (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  work_date    date not null,
  locked_by    uuid references public.staff(id) on delete set null,
  locked_at    timestamptz not null default now(),
  primary key (staff_id, work_date)
);

create index availability_locks_workspace_date_idx
  on public.availability_locks (workspace_id, work_date);

comment on table public.availability_locks is
  'Manager-set lock on a staff member''s availability for a specific date, independent of the automatic edit cutoff. Blocks staff self-service edits (see availability POST route); roster:write callers can still edit through it.';

alter table public.availability_locks enable row level security;
