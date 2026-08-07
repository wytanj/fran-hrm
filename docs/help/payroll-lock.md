---
slug: payroll-lock
title: Pay periods and payroll lock
summary: Approve then lock a period; locked timesheets are read-only and late fixes post to the next period.
category: payroll
primary_path: /reports
intent_tags: [payroll, pay period, lock, locked, read only, reopen, close period, export payroll, adjustment]
audience: [area_manager, hq_admin]
sort_order: 100
---

# Pay periods and payroll lock

## The lifecycle

1. **Open** — the default. Clocking, corrections and imports all work normally.
2. **Approved** — hours have been reviewed and the period is ready to export.
3. **Locked** — every timesheet in the window becomes read-only.

Locking is what prevents post-payroll edits. Once locked, clocking, corrections and imports against those dates are refused with an explanation rather than silently failing.

## Locking a period

Area managers and HQ admins only:

1. Create the pay period (start and end dates).
2. Review hours — see [How worked hours and overtime are calculated](/help/overtime-and-hours).
3. **Approve**, export for payroll, then **Lock**.

## Corrections found after locking

Do **not** reopen the period as a matter of course. The rule is:

> A correction found after lock is posted as a **dated adjustment in the next pay period**, not edited in place.

This keeps the exported figures and the system in agreement, which is what makes the audit trail worth having.

## Reopening

Reopening is available to area managers and HQ admins for genuine errors — a whole store missed, a systemic import fault. It:

- Returns the period to **open**
- Returns its timesheets to editable
- Is written to the audit trail with who did it and when

If you reopen a period that has already been paid, you are now responsible for reconciling the difference with payroll. Prefer the adjustment route.

## Retention

Attendance and hours records are retained for a **minimum of two years** per MOM guidance. Locking does not delete anything; it only makes it read-only.
