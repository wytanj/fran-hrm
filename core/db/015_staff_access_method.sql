-- 015 — Access-method indicator for real staff.
--
-- A real staff member shows how they get into FranHRM, as a tag beside their
-- name — so it's clear at a glance whether they're an established workspace
-- member or someone who was just invited:
--   sso = Google SSO workspace member (the SSO auth flow itself is not built yet)
--   otp = invited / phone one-time-password (Twilio — flow pending)
--   pin = employee code + PIN (today's default)
-- This is the DATA-MODEL indication only; the OTP (Twilio) and SSO sign-in
-- flows land later and will set this field. Ignored for is_dummy staff.
alter table public.staff
  add column if not exists access_method text not null default 'pin'
  check (access_method in ('sso', 'otp', 'pin'));

comment on column public.staff.access_method is
  'How a real staff member accesses FranHRM: sso (Google SSO member) | otp (invited, phone OTP via Twilio, pending) | pin (code + PIN). Shown as a tag beside the name; not meaningful for is_dummy staff.';
