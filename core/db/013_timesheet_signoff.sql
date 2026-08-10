-- 013 — Weekly timesheet sign-off (per store, per week).
--
-- Distinct from pay_periods (monthly, workspace-wide, hard payroll lock): this
-- is the OPERATIONAL weekly close a supervisor does every Monday for the week
-- just gone. Sign-off is a soft gate — after it, edits are still allowed but
-- must carry a reason and are logged (amended_* below + an audit_events row),
-- so a timesheet that feeds payroll can't be quietly changed. A week left
-- unsigned past week_end + 7 days is reported as overdue (computed, not stored).
create table public.timesheet_weeks (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  store_id        uuid not null references public.stores(id) on delete cascade,
  week_start      date not null, -- Monday; enforced in code
  status          text not null default 'open' check (status in ('open', 'signed_off')),
  signed_off_by   uuid references public.staff(id) on delete set null,
  signed_off_at   timestamptz,
  -- Edits after sign-off bump these so the week visibly needs re-review.
  amended_count   integer not null default 0,
  amended_at      timestamptz,
  last_amended_by uuid references public.staff(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (workspace_id, store_id, week_start)
);

create index timesheet_weeks_lookup_idx
  on public.timesheet_weeks (workspace_id, store_id, week_start);

alter table public.timesheet_weeks enable row level security;

comment on table public.timesheet_weeks is
  'Per-store weekly timesheet sign-off. Soft close: post-sign-off edits are allowed with a reason and logged (amended_* + audit_events). Overdue (unsigned past week_end+7d) is computed, not stored.';
