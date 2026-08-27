-- 030 — Per-person flag for whether this staff member must submit
-- day-by-day availability. Full-timers usually work a fixed pattern and
-- do not need the form; part-timers do. This is a real column, not derived
-- from employment_type, so a manager can flip it for one person (e.g. a
-- full-timer covering part-time hours for a few months) without anything
-- else about their record changing.
--
-- The roster generator already treats "no availability submitted" as
-- unconstrained (availabilityVerdict returns stated:false when there are
-- no rows). Switching this off does not change how they get scheduled.
alter table public.staff
  add column if not exists availability_required boolean not null default true;

comment on column public.staff.availability_required is
  'When true, this person fills in day-by-day Can work/Prefer/Can''t availability. Full-time staff are backfilled to false; a store/area manager can flip it per person. Independent of employment_type after create.';

update public.staff
  set availability_required = false
  where employment_type = 'full_time';

-- staff:availability_flag — same pattern as 027/028: only backfill
-- workspaces that already have an explicit role_permissions matrix (a
-- workspace with zero rows picks this up automatically from
-- DEFAULT_ROLE_MATRIX in core/permissions/catalog.mjs).
-- Store manager and area manager only — not supervisor. hq_admin is
-- included so an already-configured matrix does not deny them (missing
-- row = denied once any rows exist).
do $$
declare
  ws record;
begin
  for ws in
    select id from public.workspaces w
    where exists (select 1 from public.role_permissions rp where rp.workspace_id = w.id)
  loop
    insert into public.role_permissions (workspace_id, role, scope, allowed) values
      (ws.id, 'store_manager', 'staff:availability_flag', true),
      (ws.id, 'area_manager',  'staff:availability_flag', true),
      (ws.id, 'hq_admin',      'staff:availability_flag', true)
    on conflict (workspace_id, role, scope) do nothing;
  end loop;
end $$;
