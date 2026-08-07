-- 008 — Org structure and the accountability model.
--
-- Three separable ideas, deliberately not collapsed into one table:
--
-- 1. FUNCTIONS — the major areas of the business (Retail Ops, Marketing…).
-- 2. POSITIONS (seats) — the designed org. A seat carries the reporting line
--    and BOTH title forms: `title` is the internal/formal one used for HR and
--    payroll ("Store Supervisor"), `comms_title` is what we actually say out
--    loud and put in signatures ("Marketing Girlie"). Keeping them separate
--    means the playful name can change freely without touching anything that
--    depends on the formal grade.
-- 3. ACCOUNTABILITIES — the outcomes someone owns. Exactly ONE accountable
--    owner each: shared accountability is no accountability. Ownership attaches
--    to a SEAT by default so it survives turnover, with an optional
--    person-level override for cases where a named individual owns something
--    regardless of who holds the seat.
--
-- Hierarchy lives on positions (the designed org) AND optionally on staff (the
-- actual reporting line). Both exist because they legitimately diverge: a seat
-- can be vacant while its reports temporarily answer to someone else, and
-- resolving "who is X's manager" must not break during that gap.
--
-- Later meeting/scheduling tools read this: reporting lines drive 1:1
-- pairings, accountabilities give agenda items an owner, and cadence + metric
-- give a scorecard to review.

create table public.org_functions (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key          text not null,
  name         text not null,
  description  text,
  sort_order   integer not null default 100,
  created_at   timestamptz not null default now(),
  unique (workspace_id, key)
);

create table public.positions (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  code          text not null,
  -- Internal/formal title — HR, payroll, grading.
  title         text not null,
  -- Outward-facing name we actually use in comms. Falls back to title.
  comms_title   text,
  function_id   uuid references public.org_functions(id) on delete set null,
  -- The designed reporting line. Self-referential; null = top of the chart.
  reports_to_id uuid references public.positions(id) on delete set null,
  -- One line on why the seat exists. Forces clarity when creating one.
  purpose       text,
  -- Expected staff role for holders, so the chart and permissions agree.
  expected_role public.staff_role,
  is_leadership boolean not null default false,
  -- Planned headcount for this seat (5 associates share one seat definition).
  headcount     integer not null default 1,
  store_id      uuid references public.stores(id) on delete set null,
  is_active     boolean not null default true,
  sort_order    integer not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, code),
  -- A seat cannot report to itself. Deeper cycles are checked in code.
  check (reports_to_id is null or reports_to_id <> id)
);

create index positions_reports_to_idx on public.positions (reports_to_id);
create index positions_workspace_idx on public.positions (workspace_id, is_active);

-- Staff ← org wiring.
alter table public.staff
  add column position_id uuid references public.positions(id) on delete set null,
  -- Actual manager. Null = derive from the position's reporting line.
  add column reports_to_id uuid references public.staff(id) on delete set null,
  -- Per-person comms title override ("Marketing Girlie" for one specific hire
  -- whose seat is generically titled).
  add column comms_title text;

create index staff_reports_to_idx on public.staff (reports_to_id);
create index staff_position_idx on public.staff (position_id);

create type public.accountability_status as enum ('active', 'at_risk', 'paused', 'retired');
create type public.accountability_cadence as enum ('daily', 'weekly', 'fortnightly', 'monthly', 'quarterly', 'ad_hoc');

create table public.accountabilities (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  key          text not null,
  name         text not null,
  -- What "good" looks like. The thing being promised, not the activity.
  outcome      text,
  function_id  uuid references public.org_functions(id) on delete set null,
  -- The single accountable owner. Seat-first so it survives turnover;
  -- owner_staff_id overrides when a named person owns it personally.
  owner_position_id uuid references public.positions(id) on delete set null,
  owner_staff_id    uuid references public.staff(id) on delete set null,
  -- How it is measured and how often it is reviewed. Feeds later scorecard
  -- and meeting tooling.
  metric_name  text,
  metric_target numeric(12,2),
  metric_unit  text,
  cadence      public.accountability_cadence not null default 'monthly',
  status       public.accountability_status not null default 'active',
  store_id     uuid references public.stores(id) on delete set null,
  notes        text,
  sort_order   integer not null default 100,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (workspace_id, key),
  -- Refuse an orphan accountability: something with no owner is a wish.
  constraint accountabilities_need_owner
    check (owner_position_id is not null or owner_staff_id is not null)
);

create index accountabilities_owner_position_idx on public.accountabilities (owner_position_id);
create index accountabilities_owner_staff_idx on public.accountabilities (owner_staff_id);
create index accountabilities_status_idx on public.accountabilities (workspace_id, status);

-- Everyone else involved. The owner stays singular; these are the people who
-- do the work or need to be kept in the loop (RACI minus the A).
create type public.contributor_role as enum ('contributor', 'consulted', 'informed');

create table public.accountability_contributors (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  accountability_id  uuid not null references public.accountabilities(id) on delete cascade,
  staff_id           uuid references public.staff(id) on delete cascade,
  position_id        uuid references public.positions(id) on delete cascade,
  role               public.contributor_role not null default 'contributor',
  created_at         timestamptz not null default now(),
  check (staff_id is not null or position_id is not null)
);

create index accountability_contributors_acc_idx on public.accountability_contributors (accountability_id);

-- Periodic review record. This is what a weekly/monthly meeting writes back,
-- and what "is this on track" reads.
create table public.accountability_checkins (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  accountability_id uuid not null references public.accountabilities(id) on delete cascade,
  period_start      date not null,
  period_end        date,
  metric_value      numeric(12,2),
  status            public.accountability_status not null default 'active',
  note              text,
  recorded_by       uuid references public.staff(id) on delete set null,
  created_at        timestamptz not null default now(),
  unique (accountability_id, period_start)
);

create index accountability_checkins_acc_idx on public.accountability_checkins (accountability_id, period_start desc);

alter table public.org_functions enable row level security;
alter table public.positions enable row level security;
alter table public.accountabilities enable row level security;
alter table public.accountability_contributors enable row level security;
alter table public.accountability_checkins enable row level security;

comment on column public.positions.comms_title is
  'Outward-facing title used in comms (e.g. "Marketing Girlie"). Formal/internal title lives in positions.title.';
comment on table public.accountabilities is
  'Accountability chart: outcomes with exactly one accountable owner (seat-first, person-override). Contributors are separate on purpose.';
