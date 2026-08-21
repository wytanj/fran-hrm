---
slug: roster-generate
title: Generating a roster from constraints
summary: Say what cover you need; FranHRM assigns it around leave, availability and hour caps, then you review a draft.
category: scheduling
primary_path: /roster-builder
related_paths: [/roster, /availability]
intent_tags: [generate roster, auto roster, ai roster, build roster automatically, constraints, coverage, unfilled shifts, roster generator, lock availability, freeze availability, team availability, shift templates, hour blocks, add a shift, 3-hour shift, retire a shift]
audience: [supervisor, store_manager, area_manager, hq_admin]
sort_order: 62
---

# Generating a roster from constraints

You describe the *shape* of the week. FranHRM does the assignment.

## What you supply

**Cover** — how many people you need on each shift, each day. In **Roster builder → Generate** that is a grid: rows are days, columns are your shift blocks (templates), cells are headcount.

**Shift blocks** — the named hour ranges that become those columns (Opening 09:30–18:30, or an ad hoc 3-hour holiday block). They are not a fixed list. Open **Manage shift blocks** on the same Generate tab to add one, or retire one you no longer use. Retired blocks drop off the grid; past shifts keep their original label. Names are free text. A block is shared across stores unless you scope it to one store.

**Rules** — the limits the result must respect:

| Rule | Default | Meaning |
|---|---|---|
| Off days per week | 1 | Nobody is scheduled more than 6 days |
| Max consecutive days | 5 | Breaks up long runs, counting the previous week too |
| Min rest hours | 10 | Gap between a closing shift and the next opening |
| OT threshold | 44h | Past this, a warning is raised |

**Always enforced, whether you ask or not:** approved *and pending* leave, submitted availability, and part-time weekly hour caps. You do not need to encode these.

**Team availability** on this page shows each person's submitted preference for the week you are planning. Lock a date (or the whole week) before you generate so a late edit cannot invalidate the proposal. Unlock a date if someone genuinely needs to change it. Staff cannot lock or unlock their own dates; you can still edit availability yourself.

## What you get

A **proposal** — nothing is written yet. It shows:

- the week as a staff × day grid
- hours per person, so you can see the load is fair
- **slots it could not fill**, each with the reason every candidate was rejected
- warnings, such as someone crossing the OT threshold

That rejection list is the useful part. "Sat closing unfilled — Erin: on leave; Farah: would exceed PT cap 30h; Dylan: less than 10h rest since last shift" tells you exactly which single constraint to relax.

Generating is free and writes nothing, so re-run it after a tweak rather than fighting the result.

## Then

**Create draft roster** turns the proposal into a draft. Staff still cannot see it — the normal guardrail checks and the publish step are unchanged. See [Building and publishing a roster](/help/roster-publish).

## Saving constraints

Most weeks look like the last one. **Save these constraints as…** stores the set; pick it from the dropdown next time instead of re-entering the grid. Sets are per store.

## Asking Claude to do it

If your company has connected Claude, describe the week in plain language:

> "Build next week's Orchard roster — two on opening every day, one closing on weekdays, two closing Saturday and Sunday. Keep everyone under 44 hours and give Farah Monday off."

Claude turns that into constraints, generates the proposal, and shows you the grid and any gaps before anything is created. It cannot publish a roster — that stays a person's decision. See [Using FranHRM in Claude](/help/connect-claude).
