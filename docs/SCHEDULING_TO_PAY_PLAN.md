# Fran scheduling → pay (approved direction)

**Date:** 2026-09-11  
**Status:** approved for Engineer + Claude · realtime pilot target **week of 2026-09-15**  
**Owners:** J T (product) · Kristle + Jarell (rules) · Engineer/Claude (build) · J T creates Telegram channel+bot after build skeleton exists  

---

## Locked product intent

1. **Kristle / Jarell set rules** (not chase avail in group chat).
2. Rules are **fixated** in a versioned artifact: `scheduling_rules.json` (machine) + human `SCHEDULING_RULES.md` (same content explained).
3. Staff interact via **Telegram bot** (J T creates channel/bot once Engineer has the webhook/handlers ready).
4. **fran-hrm is the UI/UX control panel for observing and managing truth** (roster, open covers, who worked what, digests) — not a second place staff re-enter avail by default.
5. Durable truth under the panel remains structured data (shifts, people, rates) so pay can be calculated: **headcount + identity + which shifts + shift pricing → pay**.
6. Bot never treats chat history as SoT; it reads/writes through HRM APIs/MCP according to the rules artifact.

### Architecture one-liner

```
Jarell rules (JSON/MD) → bot behavior + HRM policy
Staff Telegram → bot → FranHRM data plane
FranHRM UI → observe / publish / escalate / pay inputs
```

---

## Rules artifact (fixates behavior)

**Path (proposed):** `config/scheduling_rules.json` + `docs/SCHEDULING_RULES.md` in fran-hrm (or workspace-scoped row that syncs from file in pilot).

Example shape (illustrative):

```json
{
  "version": 1,
  "store_ids": ["SGP-BUGIS-001"],
  "availability": {
    "open_day_of_prior_month": 1,
    "lock_day_of_prior_month": 7,
    "reminders": ["open", "T-3d", "T-1d", "locked"]
  },
  "publish": {
    "target_day_of_prior_month": 15,
    "guardrails": ["leave_block", "ot_warn", "rest_warn", "pt_cap_warn"]
  },
  "cover": {
    "planned_swap_min_days": 3,
    "urgent_auto_accept_first_claim": true,
    "escalate_hours_before_start": 3,
    "mc_auto_open_cover": true
  },
  "pricing": {
    "default_basis": "staff_hourly",
    "template_multipliers": { "opening": 1.0, "closing": 1.15 }
  },
  "pay": {
    "v1_basis": "clock_actuals_with_scheduled_fallback"
  },
  "telegram": {
    "pilot": true,
    "require_linked_identity": true
  }
}
```

Changing behavior = edit rules + bump version (audited). Bot and HRM both honor the same file/row.

---

## Data model (end state)

Already exist: `staff` (+ `hourly_rate_cents`), `shift_templates`, `rosters`, `shifts` (null staff = open), `availability`, `shift_swaps`, leave, hours compute, payslips.

Add in slices:
- scheduling policy / rules binding  
- cover lifecycle on shifts  
- shift pricing (template multipliers / flat) + rate snapshot  
- `shift_pay_lines` → payslip draft  

Truth panel must always answer: who, which shift, how many people/hours, price, pay.

---

## Phases (Claude execution order)

| Phase | Build | Pilot week goal |
|---|---|---|
| **P0** | Rules JSON/MD + HRM read UI for rules · Telegram identity link · avail submit/amend · reminders · avail lock · leave block · publish notify · “observation” views for missing avail | Live with Bugis+ staff on TG for **October avail** (or next month window) |
| **P1** | Planned swap/claim + cut-off | Optional if time |
| **P2** | Urgent can’t-work / MC → open cover blast · auto-claim · escalate to Jarell only | Target ASAP after P0 so 9am chase dies |
| **P3** | Shift pricing on templates | |
| **P4** | Pay lines → payslip draft | |
| **P5** | Ranking / AI draft | later |

**J T next week:** create Telegram bot + channel when Engineer says webhook URL / token env ready. Do not create before stub exists.

---

## Defaults for open decisions (unless J T overrides)

1. Urgent cover: **auto-accept first eligible claim**  
2. Pay v1: **clock actuals, fallback scheduled**  
3. Pricing v1: **template multipliers**  
4. Bot: Engineer scaffolds handlers in fran-hrm (or sibling bot repo); J T pastes bot token  
5. Pilot: Telegram **required** for rostering participants  

---

## Engineer / Claude steering brief

Goal: implement **P0** against this doc; keep fran-hrm as observation/control panel; rules artifact fixates bot+policy behavior; no WhatsApp intake; no prod Loft coupling.

Success for next-week test:
- Jarell can set/edit rules (file or admin UI that writes JSON)  
- Staff link TG ↔ staff and submit avail  
- Reminders fire per rules  
- HRM UI shows truth (submitted / missing / locked)  
- Document how J T attaches Telegram bot token + channel  

Out of scope for first Claude pass: full pay engine (stub data model ok), multi-store pool.

---

## Non-goals

- Chat history as roster SoT  
- Bot auto-publish without SM  
- Per-cashier Gmail for POS (separate PIN track)  

---

*Approved direction 2026-09-11 — CoS draft for Engineer/Claude.*
