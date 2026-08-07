-- 010 — Separate self-service from acting on other people.
--
-- 009 gave the `staff` role roster:write and attendance:write so a shop-floor
-- staff member could submit availability and request a timesheet correction.
-- But those same scopes are what marks someone as having team-wide reach
-- (editing the roster, approving corrections), so granting them to everyone
-- would have let any staff member read and act on colleagues' records.
--
-- The rule now:
--   *:read  + an identity check  → self-service (submit my availability,
--                                  request my correction, ask for leave)
--   *:write                      → acting on OTHER people (draft the roster,
--                                  approve a correction, key a manual clock)
--
-- Self-service therefore needs no write scope at all; the identity layer
-- (limitToSelf / assertCanReadStaff) already pins it to the requester.

update public.role_permissions
   set allowed = false, updated_at = now()
 where role = 'staff'
   and scope in ('roster:write', 'attendance:write');

comment on table public.role_permissions is
  'Editable role → scope matrix. Authoritative once a workspace has any rows; a missing row means denied. A *:write scope means "may act on other people''s records"; self-service needs only the matching *:read plus the identity check.';
