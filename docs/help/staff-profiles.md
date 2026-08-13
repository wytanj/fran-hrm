---
slug: staff-profiles
title: Staff profiles — what we keep on a person
summary: Open anyone from Team to see departments, titles, reporting line, salary, race, home address and citizenship. The record is extensible — add a custom field without a deploy.
category: people
primary_path: /team
related_paths: [/org, /permissions, /hrm-schema]
intent_tags: [staff profile, view staff, employee record, department, salary, race, address, citizenship, PR, foreigner, singaporean, NRIC, who reports to, direct reports, terminate staff, custom field, add field]
audience: [supervisor, store_manager, area_manager, finance, hq_admin]
sort_order: 50
---

# Staff profiles — what we keep on a person

**Team** is the directory. Click a name (or **View**) to open that person's record.

## What you see

The profile is grouped on purpose:

| Group | What's there |
|---|---|
| **Identity** | Name, code, gender, date of birth |
| **Employment** | Access role, FT / PT / contractor, store, hire/term dates, PT caps |
| **Org & hierarchy** | Seat, both titles, departments, who they report to, who reports to them |
| **Contact** | Email, phone, emergency contact |
| **Home address** | Street, unit, postal code, country |
| **Statutory (Singapore)** | NRIC/FIN, race, citizenship (Singaporean / PR / foreigner), nationality, PR start, CPF flag |
| **Pay** | Monthly salary (salaried), hourly rate (PT), bank |
| **Custom** | Anything this workspace has added |

Two titles, same rule as the rest of FranHRM: the **comms title** is what we say; the **internal title** is what payroll and contracts use. They are never mixed in one sentence.

Departments are the business functions (Retail Operations, Marketing, People…). A person can sit in more than one; the **primary** one is their home. If nobody has set departments yet, the profile shows the function on their **seat** so the org chart and the record agree.

Hierarchy is resolved, not typed in twice:

1. An explicit manager on the staff record, if one is set (interim arrangements).
2. Otherwise, whoever holds the seat their seat reports to.

A vacant or shared manager seat is reported as a gap — FranHRM will not guess.

## Who can see what

A permission answers **what kind** of data, never whose. Seeing a colleague's profile also needs team reach (any "acts on other people" permission).

| | Directory (name, title, departments, hierarchy) | Pay, race, citizenship, address, NRIC |
|---|---|---|
| **View the staff directory** (`staff:read`) | Yes | No |
| **See pay rates and manpower cost** (`reports:cost`) | Yes | Yes |
| **Create and edit staff records** (`staff:write`) | Yes, and they can edit | Yes, and they can edit |

Finance has the cost permission so they can see pay and statutory identity for CPF without being able to rewrite the record. Area managers and HQ have both.

## Editing and offboarding

**Edit** on the profile (needs **Create and edit staff records**) writes the same fields the API and Claude use. Money is dollars on the screen and **integer cents** underneath.

- **Terminate** marks a real person terminated. Timesheets and the audit trail stay. They cannot sign in. POS access is revoked and is not restored if they are later reactivated.
- **Delete dummy** hard-deletes a simulated person. Real staff cannot be purged.

Claude uses the same rules: `staff_create`, `staff_update`, `staff_delete` (terminate or purge-dummy) need `staff:write`. `staff_get` returns the full profile, with pay and PII omitted when the connection lacks the cost or write permission.

## Extending the record

Built-in fields cover the Singapore HR record. Anything else — work-pass expiry, shirt size, locker number — is a **custom profile field**.

On **Team**, open **Custom profile fields** (staff-edit permission):

1. Pick a **key** (a slug: `shirt_size`, `work_pass_expiry`). It cannot shadow a built-in name.
2. Give it a label, a type (text, number, date, yes/no, list, money) and a sensitivity (`directory`, `pii` or `compensation`).
3. Save. The field appears on every staff profile. Delete the field and every stored value goes with it.

Claude: `staff_fields_list` to see the catalog, `staff_field_upsert` to add one, `staff_update` with `custom.shirt_size` to set a value, `staff_field_delete` to remove the definition.
