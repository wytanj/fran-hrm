-- 031 — Workspace override for the scheduling rules artifact.
--
-- config/scheduling_rules.json is the versioned default (see
-- core/scheduling/rules.mjs). Vercel's serverless filesystem is read-only, so
-- "Jarell edits the rules from the admin page" has to land in a row, not the
-- file. One row per workspace; the whole document is stored so a read is one
-- lookup. GET merges file defaults → this row (a key added to the file later
-- shows up without a re-save); PUT validates, bumps version, writes
-- audit_events (object_type 'scheduling_rules').
--
-- No row = the workspace runs the file defaults. Deleting the row is the
-- "reset to defaults" action.

create table public.workspace_scheduling_rules (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  version      integer not null default 1,
  rules        jsonb not null,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.staff(id) on delete set null
);

comment on table public.workspace_scheduling_rules is
  'Per-workspace override of config/scheduling_rules.json. Absent row = file defaults. Bot, reminders and the HRM availability lock all read the merged result via core/scheduling/rules.mjs.';

alter table public.workspace_scheduling_rules enable row level security;
