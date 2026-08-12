-- 021 — Payslips (Singapore itemised) with employer + staff sign-off and an
-- append-only dispute/comment log.
--
-- Flow: finance creates a draft → issues it (employer sign-off, amounts lock) →
-- the staff member acknowledges (both parties signed = final) OR disputes. A
-- disputed slip can be reverted to draft to amend and re-issue. Comments are
-- always allowed and never deleted — that thread is the dispute record. Each
-- payslip has a unique token so it lives at its own link (print to PDF).
create type public.payslip_status as enum ('draft', 'issued', 'acknowledged', 'disputed');

create table public.payslips (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  staff_id            uuid not null references public.staff(id) on delete cascade,
  token               text not null unique,
  period_start        date not null,
  period_end          date not null,
  payment_date        date,
  currency            text not null default 'SGD',
  employer_name       text,
  employee_name       text,
  basic_salary_cents  integer not null default 0,
  allowances          jsonb not null default '[]'::jsonb,  -- [{ label, cents }]
  additions           jsonb not null default '[]'::jsonb,  -- bonuses, RD/PH pay…
  deductions          jsonb not null default '[]'::jsonb,  -- no-pay leave, etc. (excl. CPF)
  overtime_hours      numeric(6,2) not null default 0,
  overtime_pay_cents  integer not null default 0,
  cpf_employee_cents  integer not null default 0,
  cpf_employer_cents  integer not null default 0,
  gross_cents         integer not null default 0,
  net_cents           integer not null default 0,
  notes               text,
  status              public.payslip_status not null default 'draft',
  issued_by           uuid references public.staff(id) on delete set null,
  issued_at           timestamptz,
  acknowledged_at     timestamptz,
  disputed_at         timestamptz,
  created_by          uuid references public.staff(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (workspace_id, staff_id, period_start, period_end)
);
create index payslips_staff_idx on public.payslips (workspace_id, staff_id, period_start desc);
create index payslips_status_idx on public.payslips (workspace_id, status, period_end desc);
alter table public.payslips enable row level security;

create table public.payslip_comments (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  payslip_id      uuid not null references public.payslips(id) on delete cascade,
  author_staff_id uuid references public.staff(id) on delete set null,
  author_name     text,
  kind            text not null default 'comment' check (kind in ('comment', 'dispute', 'resolution')),
  body            text not null,
  created_at      timestamptz not null default now()
);
create index payslip_comments_idx on public.payslip_comments (payslip_id, created_at);
alter table public.payslip_comments enable row level security;
