---
slug: roster-change-history
title: Roster change history and disputes
summary: Every roster adjustment is logged — who changed which shift, when, from what to what, and why. Use it to settle disputes.
category: scheduling
primary_path: /roster
related_paths: [/roster, /permissions]
intent_tags: [roster history, change history, who changed my shift, shift dispute, adjustment, audit trail, roster audit, why was my shift changed, shift removed, reassigned, accountability]
audience: [supervisor, store_manager, area_manager, hq_admin]
sort_order: 65
---

# Roster change history and disputes

Every change to a roster is recorded on an append-only trail: adding a shift, moving or reassigning one, changing its times, removing it, and each publish or republish. The record keeps **who** made the change, **when** (to the minute), **what** changed (the before and after), and any **reason** that was given. This is the accountability trail for adjustments and disputes — "my shift was changed and nobody told me" has a definitive answer.

## Where to find it

Open **Roster**, pick the store and week, then click **History** in the top bar. The timeline shows the newest change first. Each entry names the person, the time, a plain-language summary of the change, and — where one was given — the reason.

Deleted shifts still appear: the trail outlives the shift, so a shift that was removed last Tuesday is still accountable.

## Recording a reason

When you add or remove a shift, there is an optional **Reason** field. It does not slow you down — leave it blank for routine work — but for anything that might be questioned later (moving someone off a shift, covering leave, a swap that was agreed verbally) a one-line reason is what turns a bare change into an explanation.

## Who can see it

Viewing history is a separate permission — **View roster change history** — set per role in **Permissions**. By default supervisors and above have it; the workspace owner can adjust which roles do. It is read-only: being able to see the history does not grant the ability to edit the roster. Seeing history for other people's shifts is a manager-level capability, kept distinct from editing so a senior reviewer can be given visibility without edit rights.

## Through Claude

Ask Claude (via the connector) things like "what changed on the Bugis+ roster this week?" or "who removed Chloe's Saturday shift and why?" — it reads the same trail through the `roster_history` tool, subject to the same permission. Changes Claude itself makes are logged too, marked as made via Claude.

## What is not here

This is the schedule's change history. **Actual** worked time — clock-in/out and corrections — lives in [Timesheets and corrections](/help/time-corrections). A dispute about *hours paid* starts there; a dispute about *what was scheduled* starts here.
