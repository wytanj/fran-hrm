---
slug: overtime-and-hours
title: How worked hours and overtime are calculated
summary: Hours are net of breaks. OT is flagged past 44h/week for review — never auto-paid.
category: attendance
primary_path: /reports
related_paths: [/clock]
intent_tags: [overtime, ot, 44 hours, how many hours, worked hours, hours calculation, mom, threshold, payroll hours]
audience: [staff, supervisor, store_manager, area_manager, hq_admin]
sort_order: 50
---

# How worked hours and overtime are calculated

## The calculation

For each day:

```
net hours = (clock out − clock in) − break minutes
```

Your **total hours** for a period is the sum of those daily nets. Breaks are always excluded, whether you clocked them individually or the shift template set them.

Weeks run **Monday to Sunday**. All dates and times are Singapore time (SGT).

## Overtime

- **Weekly OT** — hours past **44 per week**, following MOM guidance for covered employees.
- **Daily OT** — hours past the daily threshold (12 by default), flagged per day.

Both thresholds are configurable per company.

> **OT is flagged for review, not automatically paid.** FranHRM surfaces the number; what happens to it is a payroll decision made by your manager and HQ. Do not treat a flagged OT figure as approved pay.

## Where to see your hours

- Staff: your own hours only, via the reports view or by asking Claude.
- Supervisors and above: everyone at their store.
- Area managers and HQ admins: all stores, plus estimated manpower cost (hourly rate × hours).

## Asking Claude

If your company has connected Claude, you can ask directly:

> "How many hours did I work last week?"
> "How many hours did Farah work between 27 July and 2 August?"

Claude reads the same computation payroll uses, so the number will match. Managers can ask about anyone at their store; staff can only ask about themselves. See [Using FranHRM in Claude](/help/connect-claude).

## Incomplete records

An entry with a clock-in but no clock-out is counted as **incomplete** and contributes zero hours until it is fixed. If you see incomplete entries in a report, file a correction — see [Fixing a missed or wrong clock](/help/time-corrections).
