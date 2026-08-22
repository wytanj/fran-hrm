-- 027 — Split dummy-staff management out of staff:write into its own
-- staff:dummy scope, so a store manager can create/manage/View-as a
-- simulated hire without the full "create and edit real staff" permission.
--
-- Same pattern as 017/023: only backfill workspaces that already have an
-- explicit role_permissions matrix (a workspace with zero rows picks this up
-- automatically from DEFAULT_ROLE_MATRIX in core/permissions/catalog.mjs).
do $$
declare
  ws record;
begin
  for ws in
    select id from public.workspaces w
    where exists (select 1 from public.role_permissions rp where rp.workspace_id = w.id)
  loop
    insert into public.role_permissions (workspace_id, role, scope, allowed) values
      (ws.id, 'store_manager', 'staff:dummy', true),
      (ws.id, 'area_manager',  'staff:dummy', true),
      (ws.id, 'hq_admin',      'staff:dummy', true)
    on conflict (workspace_id, role, scope) do nothing;
  end loop;
end $$;
