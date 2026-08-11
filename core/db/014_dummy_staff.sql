-- 014 — Dummy (test) staff.
--
-- End-to-end testing needs throwaway people that are unmistakable on every
-- screen and can be purged cleanly afterwards. is_dummy marks them; the UI
-- shows a "Dummy" tag beside the name, and only is_dummy rows may be
-- hard-deleted (real staff are terminated, never deleted, so their timesheets
-- and audit history survive). Their dependent rows cascade on delete.
alter table public.staff
  add column if not exists is_dummy boolean not null default false;

create index if not exists staff_dummy_idx
  on public.staff (workspace_id) where is_dummy;

comment on column public.staff.is_dummy is
  'Test/throwaway staff. Tagged "Dummy" in the UI; the only rows eligible for hard delete (purge). Real staff are terminated, never deleted.';
