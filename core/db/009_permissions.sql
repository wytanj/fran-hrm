-- 009 — Role → permission matrix, and per-person overrides.
--
-- Until now "who may publish a roster" was a hardcoded role floor in each
-- route (minRole: 'store_manager'). That makes a reasonable request — "this
-- particular supervisor runs the Orchard roster, let her publish it" —
-- impossible without a code change, and it means the REST layer and the MCP
-- layer each carried their own copy of the rules.
--
-- So the matrix becomes data:
--
--   role_permissions        one row per (role, scope) with allowed true/false
--   staff_permission_grants per-person grant OR revoke, optionally expiring
--
-- Both the REST routes and the MCP scope derivation read this, so there is one
-- answer to "may this person do X" regardless of which door they came through.
--
-- NOT in scope here: WHOSE records someone may touch. That stays a separate
-- identity check (limitToSelf / assertCanReadStaff) because a permission says
-- what KIND of data, never whose.

create table public.role_permissions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  role         public.staff_role not null,
  scope        text not null,
  allowed      boolean not null default false,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.staff(id) on delete set null,
  unique (workspace_id, role, scope)
);

create index role_permissions_lookup_idx on public.role_permissions (workspace_id, role) where allowed;

-- Individual exception. `allowed = true` elevates one person above their role
-- (the senior supervisor who publishes rosters); `allowed = false` takes
-- something away without demoting them. expires_at covers temporary cover —
-- an acting manager while the store manager is on leave.
create table public.staff_permission_grants (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  scope        text not null,
  allowed      boolean not null default true,
  reason       text,
  expires_at   timestamptz,
  granted_by   uuid references public.staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  unique (staff_id, scope)
);

create index staff_permission_grants_staff_idx on public.staff_permission_grants (staff_id);

alter table public.role_permissions enable row level security;
alter table public.staff_permission_grants enable row level security;

comment on table public.role_permissions is
  'Editable role → scope matrix. Authoritative once a workspace has any rows; a missing row means denied.';
comment on table public.staff_permission_grants is
  'Per-person elevation or revocation of a single scope, optionally time-limited. Overrides the role matrix.';

-- Seed every existing workspace with the defaults that were previously
-- hardcoded, so behaviour is identical the moment this lands and the matrix is
-- something you tune rather than something you must fill in.
do $$
declare
  ws record;
  grants text[][] := array[
    -- staff
    array['staff', 'staff:read'],
    array['staff', 'org:read'],
    array['staff', 'roster:read'],
    array['staff', 'attendance:read'],
    array['staff', 'attendance:write'],   -- own corrections only (identity layer narrows it)
    array['staff', 'leave:read'],
    array['staff', 'leave:write'],
    array['staff', 'reports:read'],
    array['staff', 'roster:write'],       -- own availability / swap requests
    -- supervisor
    array['supervisor', 'staff:read'],
    array['supervisor', 'org:read'],
    array['supervisor', 'roster:read'],
    array['supervisor', 'roster:write'],
    array['supervisor', 'attendance:read'],
    array['supervisor', 'attendance:write'],
    array['supervisor', 'leave:read'],
    array['supervisor', 'leave:write'],
    array['supervisor', 'reports:read'],
    -- store_manager
    array['store_manager', 'staff:read'],
    array['store_manager', 'org:read'],
    array['store_manager', 'org:write'],
    array['store_manager', 'roster:read'],
    array['store_manager', 'roster:write'],
    array['store_manager', 'roster:publish'],
    array['store_manager', 'attendance:read'],
    array['store_manager', 'attendance:write'],
    array['store_manager', 'leave:read'],
    array['store_manager', 'leave:write'],
    array['store_manager', 'leave:approve'],
    array['store_manager', 'reports:read'],
    -- area_manager
    array['area_manager', 'staff:read'],
    array['area_manager', 'staff:write'],
    array['area_manager', 'org:read'],
    array['area_manager', 'org:write'],
    array['area_manager', 'roster:read'],
    array['area_manager', 'roster:write'],
    array['area_manager', 'roster:publish'],
    array['area_manager', 'attendance:read'],
    array['area_manager', 'attendance:write'],
    array['area_manager', 'leave:read'],
    array['area_manager', 'leave:write'],
    array['area_manager', 'leave:approve'],
    array['area_manager', 'reports:read'],
    array['area_manager', 'reports:cost'],
    array['area_manager', 'payroll:lock'],
    -- hq_admin
    array['hq_admin', 'staff:read'],
    array['hq_admin', 'staff:write'],
    array['hq_admin', 'org:read'],
    array['hq_admin', 'org:write'],
    array['hq_admin', 'roster:read'],
    array['hq_admin', 'roster:write'],
    array['hq_admin', 'roster:publish'],
    array['hq_admin', 'attendance:read'],
    array['hq_admin', 'attendance:write'],
    array['hq_admin', 'leave:read'],
    array['hq_admin', 'leave:write'],
    array['hq_admin', 'leave:approve'],
    array['hq_admin', 'reports:read'],
    array['hq_admin', 'reports:cost'],
    array['hq_admin', 'payroll:lock'],
    array['hq_admin', 'connector:manage']
  ];
  g text[];
begin
  for ws in select id from public.workspaces loop
    foreach g slice 1 in array grants loop
      insert into public.role_permissions (workspace_id, role, scope, allowed)
      values (ws.id, g[1]::public.staff_role, g[2], true)
      on conflict (workspace_id, role, scope) do nothing;
    end loop;
  end loop;
end $$;
