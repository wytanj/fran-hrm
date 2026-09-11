# Telegram todo (J T) — wire keys later

P0 scheduling bot code is on `feat/scheduling-to-pay-p0` (PR #1).  
Full steps: [`docs/TELEGRAM_BOT_SETUP.md`](./docs/TELEGRAM_BOT_SETUP.md).  
This file is the short checklist only — do when ready.

## Before keys

- [ ] Merge PR https://github.com/wytanj/fran-hrm/pull/1 (or deploy that branch)
- [ ] Run migrations on HRM Supabase (`npm run db:migrate`) if not already
- [ ] Confirm prod URL: `https://fran-hrm-lime.vercel.app`

## Create bot (BotFather)

- [ ] `@BotFather` → `/newbot`
- [ ] Display name e.g. `FranHRM Availability`
- [ ] Username e.g. `FranHrmBot`
- [ ] Save token (do not commit)
- [ ] `/setcommands` with start / link / status / avail / mine / help / unlink (see setup doc)

## Vercel env (Production)

- [ ] `TELEGRAM_BOT_TOKEN` = BotFather token
- [ ] `TELEGRAM_WEBHOOK_SECRET` = `openssl rand -hex 24`
- [ ] `CRON_SECRET` = `openssl rand -hex 24`
- [ ] Optional: `TELEGRAM_PILOT_CHAT_ID` for later digests
- [ ] Redeploy after saving env

## Webhook

- [ ] `setWebhook` to `https://fran-hrm-lime.vercel.app/api/telegram/webhook` with same `secret_token`
- [ ] `getWebhookInfo` — URL set, no last error

## Smoke

- [ ] DM bot → Start
- [ ] `/link <employee_code> <PIN>`
- [ ] `/status` then `/avail …`
- [ ] Confirm row on FranHRM **Scheduling truth** / Availability

## Pilot

- [ ] Tell Bugis+ pilot staff the bot username
- [ ] Kristle/Jarell review **Scheduling rules** JSON for next month window

---

*CoS — keys intentionally left to J T; no secrets in git.*
