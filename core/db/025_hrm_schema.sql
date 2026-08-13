-- 025 — Versioned in-force people schema.
--
-- Git authors the core document (field catalog, invariants, citizenship
-- enums). Supabase holds published snapshots. Exactly one version per
-- workspace is in_force: the unique partial index plus publish_hrm_schema()
-- make the swap a single transaction so Fran cannot have two policies live
-- or none, mid-publish.

create table if not exists public.hrm_schema_versions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  version       integer not null,
  content_hash  text not null,
  core_hash     text not null,
  git_sha       text,
  git_dirty     boolean not null default false,
  git_describe  text,
  schema_json   jsonb not null,
  schema_text   text not null,
  in_force      boolean not null default false,
  published_at  timestamptz,
  published_by  uuid references public.staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (workspace_id, version),
  unique (workspace_id, content_hash)
);

create unique index if not exists hrm_schema_one_in_force
  on public.hrm_schema_versions (workspace_id) where in_force;

create index if not exists hrm_schema_ws_idx
  on public.hrm_schema_versions (workspace_id, version desc);

alter table public.hrm_schema_versions enable row level security;

comment on table public.hrm_schema_versions is
  'Published snapshots of the people schema. Git is the authoring source; this table is the ACID in-force copy. One in_force row per workspace.';

create or replace function public.publish_hrm_schema(
  p_workspace_id uuid,
  p_version_id uuid,
  p_published_by uuid default null
) returns public.hrm_schema_versions
language plpgsql
as $$
declare
  v public.hrm_schema_versions;
begin
  if p_workspace_id is null or p_version_id is null then
    raise exception 'workspace and version are required';
  end if;

  update public.hrm_schema_versions
     set in_force = false
   where workspace_id = p_workspace_id
     and in_force
     and id is distinct from p_version_id;

  update public.hrm_schema_versions
     set in_force = true,
         published_at = now(),
         published_by = p_published_by
   where id = p_version_id
     and workspace_id = p_workspace_id
   returning * into v;

  if v.id is null then
    raise exception 'hrm schema version % is not in workspace %', p_version_id, p_workspace_id;
  end if;
  return v;
end;
$$;

comment on function public.publish_hrm_schema(uuid, uuid, uuid) is
  'Atomically mark one schema version in_force for a workspace. The unique partial index refuses a second live row.';

-- HQ Admin is the only default holder. Missing row = denied, so seed every
-- workspace that already has a matrix.
do $$
declare
  ws record;
  sc text;
begin
  for ws in
    select id from public.workspaces w
    where exists (select 1 from public.role_permissions rp where rp.workspace_id = w.id)
  loop
    foreach sc in array array['hrm_schema:read', 'hrm_schema:write'] loop
      insert into public.role_permissions (workspace_id, role, scope, allowed)
      values (ws.id, 'hq_admin'::public.staff_role, sc, true)
      on conflict (workspace_id, role, scope) do nothing;
    end loop;
  end loop;
end $$;
