-- 023 — Store layouts + zones.
--
-- A store has a layout (an uploaded floor-plan image) and a set of zones drawn
-- on it. Zones are stored resolution-independently as percentage rectangles, so
-- the same data renders as a CSS overlay at any size and is ready to feed retail
-- analytics / vision models later. Zone management ties into wage & performance
-- down the line (which zone a shift covers).
create table if not exists public.store_layouts (
  store_id       uuid primary key references public.stores(id) on delete cascade,
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  image_data_url text,        -- the floor-plan image (data URL)
  source         text,        -- 'pdf' | 'image'
  aspect         numeric(6,3),-- width / height, for the editor canvas
  updated_by     uuid references public.staff(id) on delete set null,
  updated_at     timestamptz not null default now()
);
alter table public.store_layouts enable row level security;

create table if not exists public.store_zones (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  store_id     uuid not null references public.stores(id) on delete cascade,
  name         text not null,
  code         text,
  color        text not null default '#F0C820',
  -- { type:'rect', x, y, w, h } as 0–100 percentages of the layout.
  shape        jsonb not null default '{}'::jsonb,
  sort_order   integer not null default 0,
  created_by   uuid references public.staff(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index store_zones_store_idx on public.store_zones (workspace_id, store_id, sort_order);
alter table public.store_zones enable row level security;

-- Seed the new scopes into configured workspaces (missing row = denied).
do $$
declare
  ws record;
begin
  for ws in
    select id from public.workspaces w
    where exists (select 1 from public.role_permissions rp where rp.workspace_id = w.id)
  loop
    insert into public.role_permissions (workspace_id, role, scope, allowed) values
      (ws.id, 'supervisor',    'zones:read',  true),
      (ws.id, 'store_manager', 'zones:read',  true),
      (ws.id, 'store_manager', 'zones:write', true),
      (ws.id, 'area_manager',  'zones:read',  true),
      (ws.id, 'area_manager',  'zones:write', true),
      (ws.id, 'finance',       'zones:read',  true),
      (ws.id, 'hq_admin',      'zones:read',  true),
      (ws.id, 'hq_admin',      'zones:write', true)
    on conflict (workspace_id, role, scope) do nothing;
  end loop;
end $$;
