-- 005 — Per-user OAuth 2.1 for the remote MCP endpoint (Claude connector).
-- Ported from fran-skums 082_mcp_oauth.sql, identity adapted to FranHRM staff.
--
-- Why: a Claude org stores ONE connector config (URL + optional client
-- id/secret). With API-key-in-URL, every employee shares one key and gets
-- identical MCP power. OAuth fixes that: the shared client id/secret only
-- identifies Claude-the-app; the credential that grants data access is an
-- access token minted per staff member after they sign in to FranHRM with
-- their employee code + PIN. Anthropic offers no client_credentials grant —
-- authorization_code + PKCE is the only path.
--
-- Scopes are NOT stored on the token for enforcement. The scope column is
-- audit-only; every request re-derives scopes from the staff member's CURRENT
-- role, so demoting or terminating someone cuts their Claude connection on
-- the next message, not at token expiry.

create table if not exists public.mcp_oauth_codes (
  id              uuid primary key default gen_random_uuid(),
  code_hash       text not null unique,   -- sha256; raw value only ever lives in the redirect URL
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  staff_id        uuid not null references public.staff(id) on delete cascade,
  client_id       text not null,
  redirect_uri    text not null,
  code_challenge  text not null,          -- PKCE S256, always required
  code_challenge_method text not null default 'S256',
  resource        text,                   -- RFC 8707 resource indicator
  scope           text,
  expires_at      timestamptz not null,   -- ~60s TTL
  consumed_at     timestamptz,            -- single use; a replay burns the whole grant
  created_at      timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_codes_expires
  on public.mcp_oauth_codes (expires_at);

create table if not exists public.mcp_oauth_tokens (
  id                  uuid primary key default gen_random_uuid(),
  access_token_hash   text not null unique,
  refresh_token_hash  text unique,        -- null when granted without offline_access
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  staff_id            uuid not null references public.staff(id) on delete cascade,
  client_id           text not null,
  resource            text,
  scope               text,               -- audit only; enforcement re-derives from staff.role
  expires_at          timestamptz not null,
  refresh_expires_at  timestamptz,
  rotated_from        uuid references public.mcp_oauth_tokens(id) on delete set null,
  revoked_at          timestamptz,
  revoked_reason      text,
  last_used_at        timestamptz,
  created_at          timestamptz not null default now()
);

create index if not exists idx_mcp_oauth_tokens_staff
  on public.mcp_oauth_tokens (workspace_id, staff_id)
  where revoked_at is null;

create index if not exists idx_mcp_oauth_tokens_expires
  on public.mcp_oauth_tokens (expires_at)
  where revoked_at is null;

-- Bearer-credential material: RLS on, zero policies — service role only.
alter table public.mcp_oauth_codes enable row level security;
alter table public.mcp_oauth_tokens enable row level security;

comment on table public.mcp_oauth_codes is
  'Single-use OAuth authorization codes for the remote MCP connector. Service role only.';
comment on table public.mcp_oauth_tokens is
  'Per-staff OAuth access/refresh tokens for the remote MCP connector. Scopes re-derived from staff.role on every request; scope column is audit only. Service role only.';
