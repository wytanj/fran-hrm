-- 017 — Seed the finance role's default permissions.
--
-- Separate from 016 because the 'finance' enum value it uses was added there,
-- and Postgres refuses a new enum value in the transaction that adds it.
--
-- Finance = view everything relevant to pay + lock payroll, but NOT edit
-- rosters, staff, or approve leave. It is a read-heavy admin: reports (incl.
-- cost) and payroll lock. Once rows exist for a workspace the matrix is
-- authoritative, so seed the same default into every configured workspace;
-- fresh workspaces get it from DEFAULT_ROLE_MATRIX in core/permissions/catalog.mjs.
do $$
declare
  ws record;
  finance_scopes text[] := array[
    'staff:read', 'org:read', 'roster:read', 'attendance:read',
    'leave:read', 'reports:read', 'reports:cost', 'payroll:lock'
  ];
  s text;
begin
  for ws in
    select id from public.workspaces w
    where exists (select 1 from public.role_permissions rp where rp.workspace_id = w.id)
  loop
    foreach s in array finance_scopes loop
      insert into public.role_permissions (workspace_id, role, scope, allowed)
      values (ws.id, 'finance'::public.staff_role, s, true)
      on conflict (workspace_id, role, scope) do nothing;
    end loop;
  end loop;
end $$;
