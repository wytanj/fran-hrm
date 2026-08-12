-- 019 — Statutory / payroll identity fields on staff (Singapore CPF).
--
-- NRIC/FIN and date of birth are needed for CPF; postal code + unit number for
-- the residential address. Nullable at the DB level because existing rows
-- predate them and dummy/simulated staff never need them — "mandatory on
-- creation" is a rule the Singapore create flow enforces, not a table
-- constraint. A future Malaysia workspace will key its own IDs into nric.
alter table public.staff
  add column if not exists nric          text,
  add column if not exists date_of_birth date,
  add column if not exists postal_code   text,
  add column if not exists unit_number   text;

comment on column public.staff.nric is
  'National ID for payroll/CPF (SG NRIC/FIN, e.g. S9040923I; MY MyKad in future). Sensitive PII — expose to area_manager+ only.';
comment on column public.staff.date_of_birth is 'Date of birth — required for CPF. Sensitive PII.';
