# fran-bird — Telegram company OS

**Bot name:** `fran-bird`  
**Workspace:** fran-hrm live `fran-f3a0c0`  
**Rule:** all staff-related process → Telegram. Durable SoT = fran-hrm (and ops-log for WA locks).

## Lock (J T 2026-09-16)

- **Bird = every staff’s assistant** (store / HQ / marketing) — staff-facing, **omnipotent for their role**
- **Culture:** *dunno → ask bird*
- J T keeps admin keys / env / deploy; staff never touch those
- Bird uses **scoped** bot credentials into fran-hrm — not human god tokens
- Staff-related process SoT **front door = TG**; durable = HRM / ops-log

Personal Grok Bot ≠ company OS. They do not replace each other.

## P0 (J T test) — docs only until BotFather token

1. Create bot via BotFather named **fran-bird** (token via secure channel to Engineer — **do not paste in chat**).
2. Webhook → fran-hrm; `/start` + link code ties TG user ↔ staff row.
3. Jeremy can act as store staff or marketing through the same bot.
4. Smoke: start → identity confirm → short “what now” template (no LLM essay).

**No bot wire / webhook / env until J T pastes the BotFather token via secure channel.**

## P1

- Avail / cover (scheduling→pay)
- **PIN rotate / disable confirm** (enum) — same path as POS auth theft disable; bird is the confirm surface
- Onboard script for new hires

## Token cuts

Context = `staff_id` + enum only. No chat history into LLM.

## Related

- Control-plane law: `fran-hq` → `docs/FRAN_SENTINELS.md`
- POS auth: `fran-pos` → `docs/POS_AUTH_PLAN.md` (disable/rotate confirm via fran-bird)
