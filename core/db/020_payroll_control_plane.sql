-- 020 — Payroll control plane: settings store + payroll scopes.
--
-- CPF/EOR pay settings are financial processing — only finance and hq_admin may
-- touch them, and every change is audited (see the API/MCP layer) so there is a
-- proper control plane. Store managers keep shift/time approval but never this.

create table if not exists public.payroll_settings (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  settings     jsonb not null default '{}'::jsonb,
  updated_by   uuid references public.staff(id) on delete set null,
  updated_at   timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
alter table public.payroll_settings enable row level security;

comment on table public.payroll_settings is
  'CPF/EOR pay configuration per workspace. Written only via payroll:settings; every change is logged to audit_events (control plane).';

-- Seed the two new scopes for finance + hq_admin in every configured workspace
-- (missing row = denied, so hq_admin needs an explicit row for the new scopes).
do $$
declare
  ws record;
  r text;
  sc text;
begin
  for ws in
    select id from public.workspaces w
    where exists (select 1 from public.role_permissions rp where rp.workspace_id = w.id)
  loop
    foreach r in array array['finance', 'hq_admin'] loop
      foreach sc in array array['payroll:settings', 'payroll:process'] loop
        insert into public.role_permissions (workspace_id, role, scope, allowed)
        values (ws.id, r::public.staff_role, sc, true)
        on conflict (workspace_id, role, scope) do nothing;
      end loop;
    end loop;
  end loop;
end $$;
