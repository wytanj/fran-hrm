---
slug: permissions
title: Permissions — who can do what
summary: Each role's permissions are editable, with individual exceptions. One set of rules covers the app and Claude.
category: account
primary_path: /permissions
related_paths: [/team, /connect-claude]
intent_tags: [permission, permissions, access, cannot publish, not allowed, why can't i, grant access, roster permission, who can publish, role, admin rights, 403]
audience: [supervisor, store_manager, area_manager, hq_admin]
sort_order: 95
---

# Permissions — who can do what

Nothing about access is hardcoded. Every role's permissions are a matrix you can edit in **Permissions → By role**, and individuals can be given exceptions.

## Two questions, two mechanisms

A permission answers **what kind of thing** you may do. It never answers **whose records** — that is always checked separately.

So a staff member with "View timesheets and clock yourself" sees their own timesheet, not the team's. Granting a permission never widens who someone can look at; it widens what kind of action they can take on the records they can already reach.

## Self-service needs no write permission

Submitting your own availability, requesting a swap, filing a correction on your own timesheet and applying for leave all run on the matching **view** permission plus the check that it's your own record.

The **write** permissions mean *acting on other people*: building the roster, approving a correction, keying a manual clock entry. That is why the `staff` role has no write permissions and can still do everything a staff member needs.

## The permission list

| Group | Permission | Means |
|---|---|---|
| People | View the staff directory | Names, codes, roles — needed to pick a teammate for a swap |
| People | Create and edit staff records | Add hires, change roles, reset PINs, terminate. Also the permission that lets someone edit this matrix |
| People | View / edit org chart and accountabilities | Seats, reporting lines, the accountability register |
| Scheduling | View rosters | Published rosters, plus your own availability and swap requests |
| Scheduling | Build rosters for others | Drafts, shift assignment, deciding swaps, setting anyone's availability |
| Scheduling | **Publish rosters** | Makes a week live for staff and drives attendance comparison |
| Attendance | View timesheets, and clock yourself | Your own records, and requesting your own correction |
| Attendance | Manage others' attendance | Approve corrections, manual entries, offline import, store QR, review flags |
| Leave | View / submit / **approve** | Approving debits the balance and blocks roster slots |
| Reporting | View hours and attendance reports | Worked hours, OT, exports |
| Reporting | **See pay rates and manpower cost** | Confidential — hourly rates and cost per store |
| Payroll | **Approve, lock and reopen pay periods** | Locking makes timesheets read-only |
| Admin | Manage the Claude connector | Generate credentials, invite staff, disconnect people |

The bold ones are the consequential ones. Grant them deliberately.

## Changing a role's permissions

**Permissions → By role**, then click a cell. It takes effect immediately — for the web app *and* for anyone using Claude, because both read the same matrix.

Example: your Orchard supervisor effectively runs that store's roster. Tick **Publish rosters** for Supervisor and every supervisor can publish. If you only want that one person to, use an individual exception instead.

## Individual exceptions

**Permissions → Individuals** grants or revokes one permission for one person, with an optional expiry:

- **Grant** — the strong supervisor who publishes their store's roster.
- **Revoke** — take one thing away without demoting someone.
- **Expiry** — temporary cover while a manager is on leave, so you don't have to remember to take it back.

Exceptions always beat the role matrix, and every change is written to the audit trail with who made it and why.

## Why can't I do something?

Open **Permissions → Mine**. It lists every permission with a tick or a dash, plus any individual exceptions applied to you. If something you need is missing, that page tells you exactly which permission to ask for.

Refusals name the permission too, so *"You do not have the Publish rosters (roster:publish) permission"* is actionable rather than mysterious.

## One safety rule

HQ Admin cannot have **Create and edit staff records** removed. That permission is what allows editing this matrix, so removing it would lock everyone out of their own permission screen with no way back.

## Claude uses the same rules

A staff member connecting Claude gets tools scoped to their permissions, re-checked on every message. Grant a supervisor **Publish rosters** and the `roster_publish` tool appears for them in Claude; revoke it and the tool disappears. There is no second place to keep in sync — see [Using FranHRM in Claude](/help/connect-claude).
