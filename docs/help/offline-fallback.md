---
slug: offline-fallback
title: When the system is down
summary: Work the printed roster, record times on paper, then import the sheet as CSV.
category: attendance
primary_path: /reports
related_paths: [/roster]
intent_tags: [offline, system down, downtime, cannot login, no internet, manual timesheet, import csv, fallback, outage]
audience: [supervisor, store_manager, area_manager, hq_admin]
sort_order: 70
---

# When the system is down

The store keeps trading. Attendance is reconciled afterwards.

## During the outage

1. Work from the **last printed roster**. Print a copy at the start of each week so one always exists.
2. The supervisor or store manager records clock-in and clock-out times **on paper or an Excel sheet**, per person per day.
3. Note the reason and the time window of the outage.

## After the outage — import the sheet

1. Open **Manage → Corrections**.
2. Scroll to **Offline sheet import**.
3. Paste the rows as CSV, one line per person per day:

```
employee_code,work_date,clock_in,clock_out,break_minutes,store_code
ST001,2026-08-06,09:30,18:35,60,FRAN01
PT001,2026-08-06,12:00,21:05,45,FRAN01
```

- `work_date` is `YYYY-MM-DD`
- `clock_in` / `clock_out` are 24-hour `HH:MM`, Singapore time
- The header line is optional

4. Import. Each row reports success or the reason it failed (unknown employee code, unknown store, locked pay period).

Imported entries are marked `source: import` so they are distinguishable from live clocking in every report, and the import itself is recorded in the audit trail with the row count.

## Rows that fail

- **Unknown employee_code / store_code** — check the spelling against the team list; codes are case-insensitive.
- **Locked pay period** — the period has been closed for payroll. Post the hours as an adjustment in the next period instead; see [Fixing a missed or wrong clock](/help/time-corrections).

Failed rows do not block the others. Fix and re-import only the failures — re-importing a successful row would double-count the day.
