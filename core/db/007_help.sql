-- 007 — Help centre articles.
--
-- Source of truth is docs/help/*.md in the repo (reviewable in the same PR as
-- the behaviour change); `npm run help:sync` parses the frontmatter and upserts
-- here. The DB copy exists so the MCP help tools and the /help UI can rank and
-- read articles without filesystem access at runtime (Vercel bundles are
-- read-only and Nitro would not glob them reliably).
--
-- Workspace-scoped like everything else, but articles are product
-- documentation rather than tenant data — the sync script writes one set per
-- workspace so a future white-label can diverge.

create table if not exists public.help_articles (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  slug          text not null,
  title         text not null,
  summary       text,
  body_md       text not null,
  category      text not null default 'general',
  -- Where in the app this is done, so an agent can point somewhere real
  -- instead of inventing a route.
  primary_path  text,
  related_paths text[] not null default '{}',
  -- Extra phrases a lost user might say. Ranking weights these highest.
  intent_tags   text[] not null default '{}',
  -- Which roles the article is relevant to; null/empty = everyone.
  audience      text[] not null default '{}',
  sort_order    integer not null default 100,
  published     boolean not null default true,
  source_path   text,        -- docs/help/<file>.md, for "edit this page"
  content_hash  text,        -- lets the sync script skip unchanged files
  updated_at    timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  unique (workspace_id, slug)
);

create index if not exists idx_help_articles_published
  on public.help_articles (workspace_id, published, sort_order);

alter table public.help_articles enable row level security;

comment on table public.help_articles is
  'Help centre content. Source of truth is docs/help/*.md; synced by scripts/sync-help.mjs. Service role only.';
