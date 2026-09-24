-- 032 — SG statutory timeline + pay-portal fields.
--
-- Statutory rates (CPF bands, SHG, SDL, OW/AW ceilings) are APPEND-ONLY via
-- sg_statutory_timeline. Never UPDATE a historical row — insert a new row with
-- a later effective_from so CoS can reconstruct "what was the rule on date X".
--
-- Staff columns close Aspire / ezPay / MBMF gaps and give each person a stable
-- pay-portal magic-link token (no WhatsApp; draft-first PR workflow).

-- ── Timeline (append-only) ──────────────────────────────────────────────────
create table if not exists public.sg_statutory_timeline (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  kind            text not null
    check (kind in (
      'cpf_band', 'ow_ceiling', 'aw_ceiling', 'shg_rate', 'sdl_rate', 'ot_multiplier', 'note'
    )),
  -- Free-form key within kind, e.g. cpf_band → 'citizen_55_and_below',
  -- shg_rate → 'cdac' | 'mbmf' | 'sinda' | 'ecf', sdl_rate → 'default'.
  key             text not null,
  effective_from  date not null,
  -- Optional exclusive end; null = open-ended until a later row supersedes.
  effective_to    date,
  -- Payload examples:
  --   cpf_band: { employee_pct, employer_pct, age_min, age_max, pr_year_min, pr_year_max, pr_cpf_type }
  --   ow_ceiling / aw_ceiling: { cents }
  --   shg_rate: { employee_cents } or { pct_of_ow }
  --   sdl_rate: { pct, min_cents, max_cents }
  --   ot_multiplier: { multiplier }  -- e.g. 1.5
  payload         jsonb not null default '{}'::jsonb,
  source          text,          -- e.g. 'CPF Board 2026-01 circular'
  notes           text,
  created_by      uuid references public.staff(id) on delete set null,
  created_at      timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from)
);

create index if not exists sg_statutory_timeline_lookup_idx
  on public.sg_statutory_timeline (workspace_id, kind, key, effective_from desc);

create index if not exists sg_statutory_timeline_ws_from_idx
  on public.sg_statutory_timeline (workspace_id, effective_from desc);

comment on table public.sg_statutory_timeline is
  'Append-only Singapore statutory rate history. Do not update/delete past rows; insert a new effective_from instead.';

alter table public.sg_statutory_timeline enable row level security;

-- ── Staff: religion / SHG / work pass / PR CPF type / bank / portal token ───
alter table public.staff
  add column if not exists religion            text,
  add column if not exists shg_opt_out         boolean not null default false,
  add column if not exists work_pass_type      text,
  add column if not exists work_pass_no        text,
  add column if not exists work_pass_expires_on date,
  add column if not exists pr_cpf_type         text
    check (pr_cpf_type is null or pr_cpf_type in ('FG', 'GG')),
  add column if not exists bank_bic            text,
  add column if not exists bank_account_name   text,
  add column if not exists pay_portal_token    text;

-- Stable magic link: unique when present (nulls allowed until issued).
create unique index if not exists staff_pay_portal_token_uq
  on public.staff (pay_portal_token) where pay_portal_token is not null;

comment on column public.staff.religion is
  'Religion for SHG (esp. MBMF = Muslim). Do not infer solely from race.';
comment on column public.staff.shg_opt_out is
  'When true, skip Self-Help Group deduction/agency on exports (staff opted out where allowed).';
comment on column public.staff.work_pass_type is
  'Work pass type for foreigners (EP, S Pass, WP, …).';
comment on column public.staff.work_pass_no is
  'Work pass / FIN reference number.';
comment on column public.staff.work_pass_expires_on is
  'Work pass expiry date.';
comment on column public.staff.pr_cpf_type is
  'PR CPF contribution option for ezPay Type column: FG (Full/Graduated) or GG (Graduated/Graduated).';
comment on column public.staff.bank_bic is
  'Bank BIC / Aspire bank code for payroll transfer CSV.';
comment on column public.staff.bank_account_name is
  'Account holder name as at the bank (may differ from display_name).';
comment on column public.staff.pay_portal_token is
  'Stable opaque token for the staff pay portal magic link (/pay/:token). Rotate only on explicit revoke.';
