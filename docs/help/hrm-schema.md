---
slug: hrm-schema
title: The in-force people schema
summary: HQ publishes a versioned people policy (JSON + prose). Git authors the catalogs; the database holds exactly one live copy.
category: people
primary_path: /hrm-schema
related_paths: [/team, /org, /permissions]
intent_tags: [hrm schema, people schema, in force policy, staff fields policy, citizenship values, what fields do we keep, versioned schema, publish schema]
audience: [hq_admin]
sort_order: 48
---

# The in-force people schema

Every human record in FranHRM — name, titles, departments, reporting line, salary, race, citizenship, address — is defined by **one published document**. HQ opens **Manage → HRM schema** to read it.

## Two copies, on purpose

| Where | Role |
|---|---|
| **Git** | Authors the catalogs: `core/staff/fields.mjs`, `core/hrm-schema/invariants.mjs`, the permission list. `docs/hrm-schema/people.json` and `people.md` are generated (`npm run schema:dump`) so a PR can review the policy. |
| **Supabase** | Holds **versioned snapshots**. Exactly one row per workspace is `in_force`. Publishing flips that flag in a single transaction — Fran cannot have two people policies live, or none, mid-click. |

The JSON and the verbose text are generated from the **same** object. Nobody types the citizenship list twice.

## What is in the document

- Built-in staff fields (type, sensitivity, enums)
- Citizenship: Singaporean / PR / foreigner
- Two title forms, hierarchy resolve order, one-owner accountability
- People permissions and which scopes see pay / PII
- Invariants the code already enforces
- This workspace's overlay: custom fields, org functions, leave types

## Publishing

1. A code change (or `npm run schema:sync`) **snapshots** a new version if the document hash changed. It does **not** silently replace the live one, except the first time a workspace has nothing in force.
2. An HQ admin with **Publish a people-schema version** clicks **Snapshot & publish** (or publishes an older row to roll back).
3. The previous live row stays in the versions table. It is archived, not deleted.

`npm run schema:check` fails when the git catalogs have moved on from the in-force `core_hash`, so a forgotten publish is visible in CI.

## Who can see it

Default: **HQ Admin** only (`hrm_schema:read` / `hrm_schema:write`). The matrix can grant the read to someone else; it is a permission, not a rank.

Claude uses `hrm_schema_get` for "what fields do we keep on a person?" and must not invent the list.
