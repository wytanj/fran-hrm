---
slug: roster-publish
title: Building and publishing a roster
summary: Drafts are private to managers. Publishing makes the roster live for staff and drives attendance comparison.
category: scheduling
primary_path: /roster
related_paths: [/availability]
intent_tags: [roster, build roster, publish roster, draft, schedule staff, weekly roster, guardrail, warning, copy last week, shift template]
audience: [supervisor, store_manager, area_manager, hq_admin]
sort_order: 60
---

# Building and publishing a roster

## Draft, then publish

A roster has two states:

- **Draft** — visible only to supervisors and above. Edit freely.
- **Published** — visible to staff, used for attendance comparison, and the basis for lateness and no-show flags.

Staff never see a draft. Until you publish, nobody is expected to turn up.

## Build a week

1. Open **Roster** and pick the store and week (weeks start Monday).
2. Create a draft: **Empty draft**, or **Copy last week** to start from the previous week's pattern.
3. Add shifts: choose the day, a **shift template** (Opening 09:30–18:30, Closing 12:00–21:00, Mid 10:30–19:30), and a staff member. Leave the staff blank to create an **open shift** for the part-time pool to be filled later.
4. Review the warnings.
5. **Publish**.

## Guardrail warnings

Before publishing, FranHRM checks the draft and reports:

| Warning | Meaning |
|---|---|
| **leave_clash** | Someone is scheduled on a day they have approved or pending leave |
| **pt_cap_exceeded** | A part-timer is scheduled beyond their weekly hour cap |
| **ot_projected** | Someone is scheduled past the 44h weekly OT threshold |
| **no_rest_day** | A full-timer is scheduled all 7 days with no rest day |

Warnings do not block you — they require a deliberate confirmation. Publishing with open warnings records how many were accepted in the audit trail, so the decision is attributable.

Fix a leave clash rather than accepting it. The other three are sometimes legitimate (peak weekends, a PT who asked for extra hours), which is exactly why they warn instead of refusing.

## Republishing

Editing a published roster and publishing again bumps the **version** and notifies staff. Keep late changes to a minimum — staff plan around the published version, and a shift moved after publication is a common cause of no-shows.

## Printing

Use **Print** for a paper copy at the counter. This is the downtime fallback: if the system is unavailable, staff work the printed roster and times are recorded manually. See [When the system is down](/help/offline-fallback).
