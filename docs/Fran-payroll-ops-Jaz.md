# Fran payroll ops (Jazelle)

**Audience:** Jazelle (HQ finance/payroll)  
**Workspace:** `fran-f3a0c0`  
**Last updated:** 2026-09-22 (SGT)  
**Owner:** Jeremy / Heyfran CoS — keep this file in sync when Board rules change

---

## Maintenance rule (gov / Board changes)

**Source of truth for rates is the database table `sg_statutory_timeline` (append-only), not this Markdown alone.**

Whenever CPF / SDL / SHG / OW–AW ceilings / OT policy change:

1. **Append** a new row to `sg_statutory_timeline` with the new `effective_from` (never edit old payloads).
2. **Update this file** in the same change: dates, tables below, and “Last updated”.
3. Link the CPF Board / fund circular in the timeline `source` field and note it under [Changelog](#changelog).

If the MD and the timeline disagree, **trust the timeline** and fix the MD.

---

## How payroll works (mental model)

| Layer | What it is | Who owns it |
| --- | --- | --- |
| **Staff master** | Identity + pay rates (hire date, NRIC/FIN, race, religion, residency, bank, basic/hourly) | Jaz dumps Excel/CSV → MCP diff → approve commit |
| **Hours** | Who worked which store shifts | **POS QR punches** → HRM `time_entries` (FT / PT / OT / HQ cover). Not the spreadsheet. |
| **Rules** | CPF %, ceilings, SDL, SHG bands, OT multiplier | `sg_statutory_timeline` (+ this MD mirror) |
| **Outputs** | Bank file + CPF file | Fran-hrm **Payroll** UI → **Download Aspire** + **Download CPF ezPay** |

Do **not** re-type hours from WhatsApp or Excel. Do **not** treat MCP `payroll_earnings_month` as the daily path (that is for bots / broad finance).

---

## Monthly runbook

### A. Before month-end (master hygiene)

1. Open the restricted staff workbook (Drive: *Fran-staff-payroll-PII-RESTRICTED* — Jeremy / Hiok / Jazelle only).
2. For **new joiners** or **pay/bank/NRIC changes**, export a CSV (or paste TSV) with at least:  
   `employee_code` or `email`, `display_name`, `hired_on`, `date_of_birth`, `nric`, `race`, `religion`, `residency`, `monthly_salary_cents` or `hourly_rate_cents`, `bank_bic`, `bank_account_no`, `bank_account_name`, `cpf_applicable`, `employment_type`.
3. In fran-hrm MCP (Claude / connector):
   - Call **`staff_master_import_diff`** with the CSV.
   - Read **added / changed / removed** and **validation errors** (NRIC checksum, BIC allowlist, FT needs basic / PT needs hourly, religion when MBMF path, etc.).
   - Fix the sheet and re-diff until clean.
   - Call **`staff_master_import_commit`** with `confirm=true` and the matching `draft_hash` only after you are happy.  
     Commit does **not** terminate people missing from the file.
4. **Foreigners (e.g. Korean EP/S Pass):** keep `residency=foreigner`, `cpf_applicable=false`, fill work pass type / number / expiry. Do not put them on CPF ezPay as citizens.

### B. During the month (hours)

- Store work = QR punch on POS → HRM.
- HQ person covering store: punch must be tagged job code **`hq_store_cover`** (counts as Additional Wages, not more Ordinary Wages).
- No QR / chicken-out before hire gates → ordinary wages **$0** for that period.

### C. Payday (files)

1. Fran-hrm → **Payroll** → pick month.
2. Spot-check a few people (FT basic + store OT as AW; PT from punches).
3. **Download CPF ezPay** and **Download Aspire**.
4. Upload to CPF / Aspire as today. Keep the downloaded files with the month folder in Drive (same restricted ACL).

---

## Current Board / Fran rates (mirror of timeline)

*In force for dates on/after 2026-01-01 unless noted. Citizen / PR year-3+ bands. PR year-1/2 graduated tables not seeded yet — add when first PR hire needs them.*

### CPF contribution % (2026)

| Age band (Board wording) | Employee % | Employer % |
| --- | ---: | ---: |
| 55 and below | 20 | 17 |
| Above 55 to 60 | 18 | 16 |
| Above 60 to 65 | 12.5 | 12.5 |
| Above 65 to 70 | 7.5 | 9 |
| Above 70 | 5 | 7.5 |

### Ceilings

| Item | 2025 | 2026 (current) |
| --- | ---: | ---: |
| Ordinary Wage (OW) monthly ceiling | $7,400 | **$8,000** |
| Annual salary ceiling (OW + AW subject to CPF) | $102,000 | **$102,000** |

AW subject to CPF in a calendar year ≈ max(0, $102,000 − OW that already attracted CPF).

### SDL (Skills Development Levy)

- **0.25%** of monthly total wages  
- Min **$2** / Max **$11.25** per employee per month  
- Payable for locals **and** foreigners

### OT (Fran default)

- Multiplier **1.5×** (confirm against Employment Act / Fran policy if changed)

### SHG (Self-Help Groups) — 2026 wage bands

Agency from **race** (CDAC / SINDA / ECF) or **religion=Muslim → MBMF**. Opt-out via `shg_opt_out`.

Amounts are employee deductions collected with CPF (see timeline `shg_rate` payloads for full bands):

| Fund | Monthly contribution range (by wage band) |
| --- | --- |
| CDAC | $0.50 – $3.00 |
| MBMF | $3.00 – $26.00 |
| SINDA | $1.00 – $30.00 |
| ECF | $2.00 – $20.00 |

Exact band cutovers live in `sg_statutory_timeline` (`kind=shg_rate`, keys `cdac|mbmf|sinda|ecf`).

---

## Access

| Who | HRM role | Sees NRIC / bank / salary? | Drive PII workbook |
| --- | --- | --- | --- |
| Jeremy, Hiok, Jazelle | `hq_admin` | Yes (`reports:cost` / `staff:write`) | Owner / writers only |
| Store managers (Kristle, Jarell, …) | `store_manager` | No (directory only) | No |
| `finance` role | — | Would see pay/PII | Do not assign casually |

---

## Open items (as of 2026-09-22)

- Jazelle’s own hire date / salary / bank still blank in HRM (sheet had `NA`) — fill then re-import.
- Soobin + Kim Soo Ah: foreigner path (work pass; Kim needs real SGD salary + SG bank/BIC before create).
- Religion blank for most seats — fill before first MBMF-sensitive run.
- Twin / test seats (`SSO-16E6`, `SSO-B88A`, dummies) not on the payroll master.
- Excel `.xlsx` MCP import still CSV/TSV for MVP — export CSV from Excel for diffs.
- PR year-1/2 CPF tables not in timeline yet.

---

## Changelog

| Date | Change |
| --- | --- |
| 2026-09-22 | First version. Documented Jaz runbook + mirrored 2025/2026 CPF/SDL/SHG/OT/ceilings from `sg_statutory_timeline` seed on `fran-f3a0c0`. |
