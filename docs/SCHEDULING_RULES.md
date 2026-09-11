# Scheduling rules (human copy of `config/scheduling_rules.json`)

This is the same content as the JSON, explained. The JSON is what the code
reads; this file is what Kristle and Jarell read. Change both in the same
commit, or edit from **FranHRM → Scheduling rules** (which writes a
workspace override and bumps the version — the file stays as the default a
fresh workspace starts from).

**In force: version 1.**

## Where it applies

`store_ids: ["SGP-BUGIS-001"]` — reminders and the Telegram pilot are scoped
to staff whose home store has one of these codes. Empty list = every store.
If no store in the workspace has a listed code the reminders job warns and
falls back to everyone.

## Availability window

| Rule | Value | Meaning |
|---|---|---|
| `open_day_of_prior_month` | 1 | October availability opens on 1 September. |
| `lock_day_of_prior_month` | 7 | Closes at the **end of** 7 September (SGT). From 8 September, staff cannot edit October themselves — a manager can. |
| `reminders` | open, T-3d, T-1d, locked | In-app notification + Telegram DM (if linked): on the open day, 3 days before lock, 1 day before lock (both only to people who have not submitted), and on the first locked day (everyone required; those with nothing in get the sharper wording). |

The existing 7-day cutoff (`availability_cutoff_days` in workspace settings)
still applies underneath this — the rules lock is the monthly one, the cutoff
is the "too close to re-plan" one.

## Publish

| Rule | Value | Meaning |
|---|---|---|
| `target_day_of_prior_month` | 15 | October rosters should be published by 15 September. Shown on Scheduling truth; not enforced. |
| `guardrails` | leave_block, ot_warn, rest_warn, pt_cap_warn | Checks run at publish. Warnings must be accepted with force=true. |

## Cover (recorded for P2 — not enforced yet)

| Rule | Value |
|---|---|
| `planned_swap_min_days` | 3 — a planned swap needs 3 days' notice. |
| `urgent_auto_accept_first_claim` | true — the first eligible claim on an urgent open shift is accepted automatically. |
| `escalate_hours_before_start` | 3 — unclaimed within 3 hours of start → escalate to Jarell. |
| `mc_auto_open_cover` | true — an approved MC on a rostered day opens the shift for cover. |

## Pricing and pay (recorded for P3/P4 — not applied yet)

| Rule | Value |
|---|---|
| `pricing.default_basis` | staff_hourly — the person's `hourly_rate_cents`. |
| `pricing.template_multipliers` | opening 1.0, closing 1.15. |
| `pay.v1_basis` | clock_actuals_with_scheduled_fallback — pay on clocked hours; fall back to the scheduled shift when there is no clock pair. |

## Telegram

| Rule | Value |
|---|---|
| `telegram.pilot` | true |
| `telegram.require_linked_identity` | true — the bot refuses anything but `/start`, `/help` and `/link` until the person has linked. |

## Changing a rule

1. Preferred: **FranHRM → Scheduling rules** (needs the "Build rosters for
   others" permission). Validation lists every bad field; saving bumps the
   version and writes an audit event.
2. Or edit `config/scheduling_rules.json` + this file, bump `version`, commit.
   The file is only the default — a workspace that has saved an override
   keeps its override until "Reset to file defaults".

The bot, the reminders job and the availability POST all read the merged
result on the next call (cached for 60 seconds).
