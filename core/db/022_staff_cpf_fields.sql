-- 022 — CPF/residency fields on staff, for generating the CPF EZPay template.
--
-- race drives the Self-Help Group fund (Chinese→CDAC, Malay/Muslim→MBMF,
-- Indian→SINDA, Eurasian→ECF). residency + pr_start_date drive the citizenship
-- code (1/2/3). cpf_applicable excludes work-pass foreigners from CPF entirely.
alter table public.staff
  add column if not exists race           text,
  add column if not exists residency      text check (residency in ('citizen', 'pr', 'foreigner')),
  add column if not exists cpf_applicable  boolean not null default true,
  add column if not exists pr_start_date   date;

comment on column public.staff.race is 'Ethnic group for the Self-Help Group fund (CDAC/MBMF/SINDA/ECF).';
comment on column public.staff.residency is 'citizen | pr | foreigner. Foreigners are excluded from CPF.';
