-- 031 — POS auth P0: PIN expiry + audit trail for unlock / hire-approve / disable.
-- Staff secret stays in fran-hrm only (employee_code + bcrypt PIN). fran-pos
-- verifies via HTTP; local POS passcodes are deprecated as the staff path.

alter table public.staff
  add column if not exists pin_expires_at timestamptz,
  add column if not exists pin_rotated_at timestamptz;

comment on column public.staff.pin_expires_at is
  'POS/HRM PIN validity end. Verify rejects when past. Default issuance = 12 months.';
comment on column public.staff.pin_rotated_at is
  'When the current PIN hash was last set (hire-approve or rotate).';

create table if not exists public.pos_auth_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  event_type text not null check (event_type in (
    'unlock_ok', 'unlock_fail', 'hire_approve', 'hire_reject', 'hire_hold', 'disable'
  )),
  staff_id uuid references public.staff(id) on delete set null,
  employee_code text,
  actor_staff_id uuid references public.staff(id) on delete set null,
  actor_name text,
  store_code text,
  register_id text,
  device_token text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists pos_auth_events_workspace_idx
  on public.pos_auth_events (workspace_id, created_at desc);
create index if not exists pos_auth_events_staff_idx
  on public.pos_auth_events (staff_id, created_at desc);

alter table public.pos_auth_events enable row level security;

-- Seed new scopes onto existing role matrices (idempotent).
do $$
declare
  ws record;
begin
  for ws in select id from public.workspaces loop
    -- M2M verify: not on human roles by default (API keys carry it).
    insert into public.role_permissions (workspace_id, role, scope, allowed)
    values
      (ws.id, 'hq_admin', 'pos:verify', true),
      (ws.id, 'hq_admin', 'pos:disable', true),
      (ws.id, 'area_manager', 'pos:disable', true),
      (ws.id, 'store_manager', 'pos:disable', true)
    on conflict (workspace_id, role, scope) do nothing;
  end loop;
end $$;
