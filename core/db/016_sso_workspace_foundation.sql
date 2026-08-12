-- 016 — SSO + multi-tenant foundation (data model only; auth wiring lands with
-- the Supabase client once the anon key is in env).
--
-- Google (Supabase Auth) proves identity; a staff row links that identity to
-- ONE workspace with a role. Floor staff stay on code+PIN (auth_user_id null).
-- New admins/finance create or are invited into a workspace. Every mutation
-- still resolves the workspace from the staff row, never from client input —
-- that is the isolation guarantee.
--
-- Note: the new 'finance' enum value is ADDED here but its role_permissions are
-- seeded in 017, because Postgres forbids USING a new enum value in the same
-- transaction that adds it.

-- Links a staff/member to their Google (Supabase Auth) identity. Null for
-- PIN-only floor staff. Unique so one Google account maps to one member.
alter table public.staff
  add column if not exists auth_user_id uuid unique;

-- Who created the workspace (its founding admin). Nullable for the seeded one.
alter table public.workspaces
  add column if not exists created_by uuid references public.staff(id) on delete set null;

-- Finance is a first-class role (specialist admin). Permissions seeded in 017.
alter type public.staff_role add value if not exists 'finance';

-- Invitations to JOIN an existing workspace (admins, finance, managers). An
-- invited email that signs in with Google is matched here and joined with the
-- role on the invite. Joining is always invite-only; creating a NEW workspace
-- is gated separately in the app (restricted to allowlisted domains/emails).
create table if not exists public.workspace_invites (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  email             text not null,
  role              public.staff_role not null default 'staff',
  token             text not null unique,
  invited_by        uuid references public.staff(id) on delete set null,
  note              text,
  expires_at        timestamptz not null,
  accepted_at       timestamptz,
  accepted_staff_id uuid references public.staff(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- One live invite per email per workspace; matching is case-insensitive.
create unique index if not exists workspace_invites_pending_idx
  on public.workspace_invites (workspace_id, lower(email)) where accepted_at is null;
create index if not exists workspace_invites_email_idx
  on public.workspace_invites (lower(email)) where accepted_at is null;

alter table public.workspace_invites enable row level security;

comment on column public.staff.auth_user_id is
  'Supabase Auth (Google) user id for SSO members; null for PIN-only floor staff.';
comment on table public.workspace_invites is
  'Invitations to join an existing workspace with a role. Joining is invite-only; creating a new workspace is gated separately in the app.';
