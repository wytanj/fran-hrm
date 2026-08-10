---
slug: timesheet-signoff
title: Weekly timesheet sign-off
summary: Supervisors sign off each store's week. Unsigned weeks go overdue after 7 days; edits after sign-off need a reason and are logged.
category: attendance
primary_path: /reports
related_paths: [/reports, /help/time-corrections, /help/payroll-lock]
intent_tags: [timesheet, sign off, signoff, approve timesheet, weekly close, overdue timesheet, edit after signoff, past close, amend timesheet, close the week]
audience: [supervisor, store_manager, area_manager, hq_admin]
sort_order: 40
---

# Weekly timesheet sign-off

Each store's week of time entries should be **signed off** by a supervisor (or above) once it's been checked — normally at the start of the following week. Sign-off is the operational "this week is correct" step that sits **before** the monthly [payroll lock](/help/payroll-lock).

## Sign off a week

**Timesheets & reports → Sign-off.** Each row is one store-week (Mon–Sun) that has time entries. Check the hours, then **Sign off**. One action covers every staff member's entries for that store that week.

## Overdue

A week left open past **its end + 7 days** is flagged **overdue** — a red indicator on the Sign-off tab and a count on the tab itself. Overdue simply means "nobody has confirmed this week yet"; it clears the moment you sign off. This is computed from the date, so it appears on its own as weeks age.

## Editing after sign-off

Sign-off is a **soft** close, not a lock. If a correction comes in for a week you already signed off:

1. Approving it asks you for a **reason** for the after-close edit.
2. The edit is applied and **logged** (who, when, why) so a timesheet feeding payroll is never quietly changed.
3. The week is marked **amended** (with a count) so you know to re-check it.

This is different from the [payroll lock](/help/payroll-lock): a *locked* pay period refuses in-place edits outright (corrections post to the next period). Sign-off allows the edit but records it.

## Exports

The **CSV** and **JSON** buttons export the current tab (Hours or the scheduled-vs-actual attendance view) for the selected dates and store. The same data is available over the API and to Claude (the `timesheet_status` tool reports which weeks are signed off, open or overdue).
