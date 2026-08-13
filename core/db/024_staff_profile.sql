-- 024 — Extensible staff profile: first-class HR fields + departments +
-- workspace-defined custom fields.
--
-- Built-in columns cover the Singapore HR record a permissioned admin expects
-- on "view staff" (pay, citizenship, race, full home address, emergency
-- contact, bank). Everything else a workspace invents — work-pass expiry,
-- shirt size, locker number — lives in staff_profile_fields /
-- staff_profile_values so adding a field is a catalog row, not a migration.
--
-- Departments are many-to-many against org_functions (Retail Ops, Marketing…).
-- A person can sit in more than one; is_primary marks the home function.
-- When no explicit membership exists, the profile projection falls back to
-- the seat's function so existing org data still reads as a department.

alter table public.staff
  add column if not exists monthly_salary_cents integer
    check (monthly_salary_cents is null or monthly_salary_cents >= 0),
  add column if not exists gender text,
  add column if not exists nationality text,
  add column if not exists address_line_1 text,
  add column if not exists address_line_2 text,
  add column if not exists country text,
  add column if not exists emergency_contact_name text,
  add column if not exists emergency_contact_phone text,
  add column if not exists bank_name text,
  add column if not exists bank_account_no text;

comment on column public.staff.monthly_salary_cents is
  'Monthly basic salary in integer cents (FT / salaried). Hourly staff keep hourly_rate_cents. Sensitive — reports:cost or staff:write.';
comment on column public.staff.gender is
  'Optional. Catalog values: female | male | non_binary | prefer_not_to_say | other.';
comment on column public.staff.nationality is
  'Nationality as stated (e.g. Singaporean, Malaysian). Distinct from residency/citizenship.';
comment on column public.staff.address_line_1 is
  'Home address line 1 (block / street). Sensitive PII.';
comment on column public.staff.country is
  'ISO-ish country code or name; default treated as SG when blank.';
comment on column public.staff.bank_account_no is
  'Payroll bank account. Compensation-sensitive — never on a directory read.';

-- A staff member may belong to several functions (matrix / dual-hat).
create table if not exists public.staff_departments (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  function_id  uuid not null references public.org_functions(id) on delete cascade,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  unique (staff_id, function_id)
);

create index if not exists staff_departments_staff_idx
  on public.staff_departments (staff_id);
create index if not exists staff_departments_ws_idx
  on public.staff_departments (workspace_id, function_id);
create unique index if not exists staff_departments_one_primary
  on public.staff_departments (staff_id) where is_primary;

comment on table public.staff_departments is
  'Staff ↔ org_functions memberships. is_primary is the home department; the profile falls back to the seat function when this table is empty.';

-- Workspace-defined fields. key is the stable slug agents and the API use.
create table if not exists public.staff_profile_fields (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key          text not null,
  label        text not null,
  description  text,
  field_type   text not null default 'text'
    check (field_type in ('text', 'number', 'date', 'boolean', 'enum', 'money_cents')),
  field_group  text not null default 'custom',
  sensitivity  text not null default 'directory'
    check (sensitivity in ('directory', 'pii', 'compensation')),
  options      jsonb,
  required     boolean not null default false,
  sort_order   integer not null default 100,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, key),
  check (key ~ '^[a-z][a-z0-9_]{1,62}$')
);

create index if not exists staff_profile_fields_ws_idx
  on public.staff_profile_fields (workspace_id, is_active, sort_order);

comment on table public.staff_profile_fields is
  'Workspace-defined staff profile fields. Built-in HR columns live on staff; this table is how a workspace extends the record without a migration.';

create table if not exists public.staff_profile_values (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  field_id     uuid not null references public.staff_profile_fields(id) on delete cascade,
  value_text   text,
  updated_at   timestamptz not null default now(),
  unique (staff_id, field_id)
);

create index if not exists staff_profile_values_staff_idx
  on public.staff_profile_values (staff_id);
create index if not exists staff_profile_values_ws_idx
  on public.staff_profile_values (workspace_id, field_id);

comment on table public.staff_profile_values is
  'Values for workspace-defined staff_profile_fields. Stored as text; coerced by field_type on read.';

alter table public.staff_departments enable row level security;
alter table public.staff_profile_fields enable row level security;
alter table public.staff_profile_values enable row level security;
