-- 012 — Roster change history for adjustments and disputes.
--
-- Every roster/shift mutation already writes an audit_events row (before/after,
-- actor, source). What was missing was a way to READ it back scoped to one
-- roster — and a way to answer that query cheaply, including for shifts that
-- were later deleted (their audit row survives; the shift does not).
--
-- Shift audit events now carry roster_id in their metadata (set in the API
-- layer). This partial index makes "the whole change log for this week"
-- an indexed lookup rather than a JSON scan of the audit stream.
create index if not exists audit_events_roster_idx
  on public.audit_events (workspace_id, (metadata->>'roster_id'))
  where object_type = 'shifts';

-- roster:history is a new, editable permission (see core/permissions/catalog.mjs).
-- Workspaces that have NEVER configured a matrix fall back to the shipped
-- defaults, which already include it. But once a workspace has ANY
-- role_permissions rows, they are authoritative and a missing row means denied
-- — so a workspace that configured its matrix before this migration would have
-- nobody able to view history. Seed the same manager-and-above default there,
-- without touching a decision an admin may already have made.
do $$
declare
  ws record;
  managerial text[] := array['supervisor', 'store_manager', 'area_manager', 'hq_admin'];
  r text;
begin
  for ws in
    select id from public.workspaces w
    where exists (select 1 from public.role_permissions rp where rp.workspace_id = w.id)
  loop
    foreach r in array managerial loop
      insert into public.role_permissions (workspace_id, role, scope, allowed)
      values (ws.id, r::public.staff_role, 'roster:history', true)
      on conflict (workspace_id, role, scope) do nothing;
    end loop;
    -- staff explicitly denied by default; an admin can grant it in the matrix.
    insert into public.role_permissions (workspace_id, role, scope, allowed)
    values (ws.id, 'staff'::public.staff_role, 'roster:history', false)
    on conflict (workspace_id, role, scope) do nothing;
  end loop;
end $$;
