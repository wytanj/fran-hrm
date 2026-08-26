-- 029 — In-app notifications.
--
-- A general, reusable inbox for staff. The first trigger is availability
-- lock/unlock (see core/roster/query.mjs); later events (leave approved,
-- invite accepted, …) reuse the same table via `type` + `link` without a
-- schema change. In-app only — no email pipeline.
--
-- Recipient is staff_id. RLS on, zero policies; service-role only, every
-- query must still filter workspace_id.

create table public.notifications (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  staff_id     uuid not null references public.staff(id) on delete cascade,
  type         text not null,
  title        text not null,
  body         text,
  link         text,
  metadata     jsonb not null default '{}'::jsonb,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

create index notifications_recipient_idx
  on public.notifications (workspace_id, staff_id, created_at desc);

create index notifications_unread_idx
  on public.notifications (workspace_id, staff_id, created_at desc)
  where read_at is null;

comment on table public.notifications is
  'In-app notifications for a staff member. type/link/metadata are generic so new event kinds do not need a schema change. Written via core/notifications/record.mjs; never emailed.';

alter table public.notifications enable row level security;
