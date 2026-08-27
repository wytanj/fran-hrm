# Changelog

Session log of shipped changes (all committed, merged to `main`, and deployed to production unless noted). Newest first.

## 2026-08-27 — Per-person availability-required flag

Full-timers usually work a fixed pattern and don't need to submit day-by-day availability. Adds `staff.availability_required` — a real per-person column, not derived from `employment_type` — so a store or area manager can switch it off for someone (full-timers start off by default) and back on later, e.g. if a full-timer is covering part-time hours for a few months. New `staff:availability_flag` scope (store manager, area manager, HQ — not supervisor). `/availability` greys out and disables the form when off, and the server blocks self-service submission the same way, not just the UI. Roster generation is unaffected — a person with no submitted availability was already treated as unconstrained.

Migration `030_availability_required.sql`. Toggle lives on Roster builder → Team availability.

## 2026-08-26 — In-app notifications + week-by-week lock history

Closes the loop on the availability-lock feature below: locking someone's availability now sends them an in-app notification (bell icon + unread badge in the topbar), worded for the whole date range in one message, not one per date. In-app only, no email. Built as a general, reusable inbox (`notifications` table) so future events can reuse it.

Also adds a **Lock history** panel (Roster builder → Team availability) — a week-by-week, browsable log of who locked or unlocked whose availability and when, reusing the calendar-nav component below. No new table for this — it reads the audit trail the lock feature already wrote.

Migration `029_notifications.sql`.

## 2026-08-24 — Day/week/month calendar navigation

Every date-browsing screen (`/roster`, `/availability`) now has a Day/Week/Month toggle, navigable up to 12 months back or forward from today (clamped, doesn't silently snap). Replaced five separate hand-rolled copies of the same week-math scattered across the app with one shared date module + `useDateRangeNav` composable + `UiCalendarNav` component. Roster generation itself stays week-only by design (a roster is always one Monday-start week) — only the *browsing* view got day/month.

## 2026-08-23 — Store & area managers can invite teammates

New `staff:invite` scope, split off `staff:write` the same way as the dummy-staff permission below, so a store manager can invite a new hire without full staff-editing rights. Capped so nobody can invite at a role senior to their own (an invite creates a real account, so this closes a real privilege-escalation path). Migration `028_staff_invite_permission.sql`.

## 2026-08-22 — View as dummy staff + staff:dummy permission

**View as**: a manager can temporarily switch their own session into a dummy (simulated) staff member's — a real session swap with a persistent "Viewing as…" banner and one-click exit — to see exactly what a prospective hire's roster/availability would look like once scheduled. Hard-gated to dummy staff only, never a real person.

**staff:dummy permission**: split dummy-staff creation/management off the general `staff:write` scope into its own scope, granted to store managers and area managers (previously area-manager-only, bundled with full staff editing). Closed the privilege-escalation path this opens: a dummy can never be created at a role senior to its creator's own — otherwise a store manager could mint a fake HQ admin and "View as" their way to real elevated access. Migration `027_dummy_staff_permission.sql`.

## 2026-08-21 — Shift templates, availability locks, MCP parity

- **Shift templates ("hour blocks")**: managers can create/retire named shift blocks (e.g. an ad hoc 3-hour holiday block) from Roster builder, instead of these being seed-only.
- **Availability locks**: a manager can freeze a staff member's availability for specific dates or a whole week while building a roster, independent of the normal 7-day self-edit cutoff.
- **MCP tools**: both of the above exposed to Claude (`shift_template_list/create/update/retire`, `availability_lock`), keeping the web app and Claude on the same permission rules per this repo's double-gate convention.

Migration `026_availability_locks.sql`.

## Also this session

- Fixed a real checksum-integrity bug: `core.autocrlf` on Windows had silently rewritten an already-applied migration to CRLF, which would have blocked every future migration run. Restored it byte-for-byte and added `.gitattributes` to pin `core/db/*.sql` to LF permanently.
- Created the first real store for the live `@heyfran.com` workspace (`SGP-BUGIS-001` / "Fran (Bugis+)") and assigned the two live store managers to it, which was blocking the store check-in QR from working at all.
- Recommendation on file: hold off on the `fran-pms` repo / skums-as-store-master migration until there's a second physical store — not worth the overhead for one store yet.

## Follow-up still open

- `/hrm-schema` is one version behind git after the availability-required field was added — an HQ admin should open it and publish when convenient (documentation/governance only, nothing functionally broken).
- Next planned: a configurable monthly availability-submission deadline policy ("must submit by the 15th for next month"), building on the notification system and the availability-required flag above — reporting + reminders, not a hard block, per the direction agreed before this file was written.
