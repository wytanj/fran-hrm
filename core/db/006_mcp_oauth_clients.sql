-- 006 — Registered OAuth clients for the Claude connector.
--
-- One row per workspace holds the client id/secret an admin pastes into
-- Claude's connector settings. Kept in the DB (not only env vars) so rotating
-- a leaked secret is a button in FranHRM rather than a Vercel edit + redeploy.
-- Rotation keeps the same client_id and replaces only the secret, so the admin
-- updates one field in Claude instead of re-adding the connector.

create table if not exists public.mcp_oauth_clients (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  client_id          text not null unique,
  client_secret_hash text,               -- null = public client (no secret)
  secret_prefix      text,               -- first chars, so Settings can show which secret is live
  label              text,
  created_by         uuid references public.staff(id) on delete set null,
  created_at         timestamptz not null default now(),
  rotated_at         timestamptz,
  last_used_at       timestamptz,
  revoked_at         timestamptz,
  revoked_reason     text
);

create index if not exists idx_mcp_oauth_clients_workspace
  on public.mcp_oauth_clients (workspace_id)
  where revoked_at is null;

alter table public.mcp_oauth_clients enable row level security;

comment on table public.mcp_oauth_clients is
  'OAuth client credentials for the Claude MCP connector, one live row per workspace. Service role only.';

-- ---------------------------------------------------------------------------
-- Connect invites: the "invite link" path.
--
-- An admin generates a link; the staff member opens it, signs in with their
-- employee code + PIN (or is already signed in), and lands on the consent
-- screen with the connector details prefilled. The invite proves the admin
-- intended this person to connect; the PIN login proves they are that person.
-- Scopes still come from their live role, never from the invite.
-- ---------------------------------------------------------------------------
create table if not exists public.mcp_connect_invites (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  token         text not null unique,
  staff_id      uuid references public.staff(id) on delete cascade, -- null = anyone who can sign in
  note          text,
  created_by    uuid references public.staff(id) on delete set null,
  expires_at    timestamptz not null,
  used_at       timestamptz,
  used_by       uuid references public.staff(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists idx_mcp_connect_invites_token
  on public.mcp_connect_invites (token);

alter table public.mcp_connect_invites enable row level security;

comment on table public.mcp_connect_invites is
  'Single-use invite links that walk a staff member through connecting Claude. Service role only.';
