-- 032 — Telegram identity link for the availability bot.
--
-- A staff member proves who they are once by messaging the bot
-- `/link <employee_code> <PIN>` (PIN verified with bcrypt exactly like web
-- login, including the failed-attempt lockout). After that the bot resolves
-- telegram_user_id → staff and every write goes through the same core
-- functions the web app uses — chat is never the source of truth.
--
-- One Telegram account per staff member and one staff member per Telegram
-- account. chat_id is where we DM them (for a private chat it equals the
-- user id, but Telegram documents them as distinct, so both are kept).

create table public.staff_telegram_links (
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  staff_id          uuid primary key references public.staff(id) on delete cascade,
  telegram_user_id  bigint not null unique,
  chat_id           bigint not null,
  telegram_username text,
  linked_at         timestamptz not null default now(),
  last_seen_at      timestamptz
);

create index staff_telegram_links_workspace_idx
  on public.staff_telegram_links (workspace_id);

comment on table public.staff_telegram_links is
  'Telegram user ↔ staff identity link, created by /link <code> <PIN> to the bot. Deleting the row (or the staff) revokes the bot''s access for that person.';

alter table public.staff_telegram_links enable row level security;
