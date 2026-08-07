---
slug: roster-import-export
title: Importing and exporting rosters (Sheets, Airtable, CSV)
summary: Paste your existing sheet in whatever format it is; export to Sheets, Airtable or CSV.
category: scheduling
primary_path: /roster-builder
related_paths: [/roster]
intent_tags: [import roster, upload roster, spreadsheet, google sheets, excel, csv, airtable, export roster, column mapping, paste roster]
audience: [supervisor, store_manager, area_manager, hq_admin]
sort_order: 64
---

# Importing and exporting rosters

## Importing the sheet you already keep

You do not have to reformat anything. **Roster builder → Import a sheet**, then paste — select the cells in Google Sheets or Excel and paste straight in, header row included. CSV text works too.

### Both layouts are understood

**Staff × day grid** — one row per person, one column per date:

```
Staff       Mon 17/08   Tue 18/08   Wed 19/08
Chloe Tan   Opening     Closing     OFF
Dylan Ng    OFF         Opening     12:00-21:00
```

**One row per shift:**

```
Date,Staff,Shift,Break
17/08/2026,Chloe Tan,Opening,60
17/08/2026,Dylan Ng,12:00-21:00,60
```

The layout is detected from your headers. If it guesses wrong, switch it.

### Confirm the columns

Next you see one row per column in your sheet: its name, its first value, and what it will be imported as. Anything recognised is already filled in with a ✓ (high confidence) or ~ (worth checking). Fix any dropdown and click **Re-check**.

Recognised column names include *Employee Code / Emp No / Staff ID*, *Staff / Name / Team Member / BA*, *Date / Dt / Work Date*, *Shift / Template / Duty*, *Start / Time In / From*, *End / Time Out / To*, *Break*, *Job / Role / Station*, *Store / Outlet / Branch*.

### What the values may look like

- **Dates** — `2026-08-17`, `17/08/2026`, `17 Aug`, or a column header like `Mon 17/08`. Day-first is assumed; a `week_start` fills in a missing year.
- **Shifts** — a template name (`Opening`), common shorthand (`AM`, `PM`), or a range (`09:30-18:30`, `9.30am to 6.30pm`).
- **Days off** — blank, `OFF`, `RD`, `X`, `-`, `Rest`, `Nil`. These are skipped, not imported as shifts.
- **People** — an employee code is safest. Names are matched, and an ambiguous name is reported rather than guessed.

### Dry run first

Before anything is written you get: how many shifts were found, how many cells were days off, and **every row that failed with the reason**. A row with an unknown name fails alone — the rest of the sheet still imports.

Then **Import** creates a **draft** roster per week the sheet covers. Nothing goes live until someone publishes it.

### Remember the mapping

Fill in **Remember this mapping as…** and next time pick it from the dropdown — no mapping step at all. Useful for a sheet you re-upload every week.

## Exporting

**Roster builder → Export**, or the API. Four shapes:

| Format | Use it for |
|---|---|
| **Sheets (grid)** | The staff × day view people read. Paste into a Sheets selection. |
| **Sheets (rows)** | One row per shift — pivot tables, and **re-imports cleanly** |
| **Airtable** | Ready-to-POST records; field names match the column labels |
| **CSV** | Downloads a file |

The rows export and the importer use the same columns, so an exported sheet can be edited by hand and brought straight back in.

### Airtable

The export gives you `{ "records": [...] }` plus the field schema. POST in batches of 10 to `https://api.airtable.com/v0/{baseId}/{tableName}`. Create your base's columns from the field list and the names line up on the first try.

## Asking Claude

> "Here's our roster sheet — load it in" *(paste it)*
> "Put next week's Orchard roster in a format I can paste into Sheets"
> "Give me the roster as Airtable records"

Claude reads the same importer, so it will tell you which columns it matched and which rows it could not read before committing anything.
