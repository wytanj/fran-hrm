-- 028 — Give store managers and area managers a dedicated staff:invite
-- permission, separate from staff:write, mirroring 027's staff:dummy split.
--
-- An invite can carry any role, so the route caps the assignable role at
-- the inviter's own when they hold staff:invite alone (not staff:write) —
-- see server/api/v1/workspace-invites/index.post.ts.
do $$
declare
  ws record;
begin
  for ws in
    select id from public.workspaces w
    where exists (select 1 from public.role_permissions rp where rp.workspace_id = w.id)
  loop
    insert into public.role_permissions (workspace_id, role, scope, allowed) values
      (ws.id, 'store_manager', 'staff:invite', true),
      (ws.id, 'area_manager',  'staff:invite', true),
      (ws.id, 'hq_admin',      'staff:invite', true)
    on conflict (workspace_id, role, scope) do nothing;
  end loop;
end $$;
