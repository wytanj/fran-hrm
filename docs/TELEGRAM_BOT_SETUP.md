# Telegram availability bot — setup for J T

The code side is done and deployed with this branch. Nothing talks to Telegram
until the token is in Vercel, so the order below matters: **deploy first, then
create the bot, then point the bot at the deployment.**

## Environment variables

| Variable | Required | What it is |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | for the bot | The token BotFather gives you (`123456789:AAH…`). Without it every Telegram send is a logged no-op; the webhook, `/link`, in-app notifications and the truth panel still work. |
| `TELEGRAM_WEBHOOK_SECRET` | strongly recommended | Any random string (e.g. `openssl rand -hex 24`). You pass the same value as `secret_token` when calling `setWebhook`; the webhook rejects any update that does not echo it. |
| `TELEGRAM_PILOT_CHAT_ID` | optional | Numeric chat id of the pilot channel/group for manager digests (negative number for groups). Not read by any P0 code path yet — reserved for P2 cover blasts. |
| `CRON_SECRET` | for reminders | Any random string. Vercel sends it as `Authorization: Bearer …` to the daily reminders job. Also lets you trigger the job by hand with curl. |

All four are listed (empty) in `.env.example`. **Never commit real values.**

## Steps

### 1. Deploy the branch (or merge to main)

Vercel project `wytanjs-projects/fran-hrm` → https://fran-hrm-lime.vercel.app.
Run the migrations against the HRM Supabase project first if they have not
been applied (`npm run db:migrate` — adds `workspace_scheduling_rules` and
`staff_telegram_links`).

### 2. Create the bot in Telegram

1. Open **@BotFather** → `/newbot`.
2. Name: `FranHRM Availability` (display) · username: something ending in `bot`, e.g. `FranHrmBot`.
3. Copy the token.
4. Optional but nice: `/setcommands` and paste

   ```
   start - Connect and see what to do
   link - Link this Telegram to your staff record: /link CODE PIN
   status - Which month is open and what you submitted
   avail - Submit availability: /avail 3 oct cant
   mine - Everything you submitted for the open month
   help - Command reference
   unlink - Disconnect this Telegram
   ```

5. Optional: `/setprivacy` → **Disable** is NOT needed. The bot only needs
   private chats; leave privacy on.

### 3. Add env vars in Vercel and redeploy

Vercel → Project → **Settings → Environment Variables** (Production, and
Preview if you want to test on a preview URL):

```
TELEGRAM_BOT_TOKEN      = <from BotFather>
TELEGRAM_WEBHOOK_SECRET = <openssl rand -hex 24>
CRON_SECRET             = <openssl rand -hex 24>
```

Then **Deployments → ⋯ → Redeploy** (env vars only apply to new builds).

### 4. Point the bot at the webhook

Replace the two placeholders and run once:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -d "url=https://fran-hrm-lime.vercel.app/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d "allowed_updates[]=message" \
  -d "allowed_updates[]=callback_query" \
  -d "drop_pending_updates=true"
```

Check it took:

```bash
curl -s "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

`url` should be the Vercel URL and `last_error_message` empty. If you see
`401` there, the `secret_token` you sent does not match `TELEGRAM_WEBHOOK_SECRET`
on Vercel.

### 5. Test with your own account

1. Open the bot in Telegram, press **Start**.
2. `/link <your employee code> <your PIN>` — same as web sign-in. The bot
   deletes that message afterwards so the PIN does not sit in the chat.
3. `/status` → shows the open month, lock date, what you have submitted.
4. `/avail 3 oct cant` → saved; it appears immediately on
   **FranHRM → Availability** and on **Scheduling truth**.

### 6. Reminders

`vercel.json` schedules `GET /api/v1/scheduling/reminders/run` daily at
**01:00 UTC = 09:00 SGT**. Vercel attaches `Authorization: Bearer $CRON_SECRET`
automatically once the env var exists. What fires on a given day comes from
**Scheduling rules → Reminders** (`open`, `T-3d`, `T-1d`, `locked`).

Run it by hand (all workspaces):

```bash
curl -s -X POST "https://fran-hrm-lime.vercel.app/api/v1/scheduling/reminders/run" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

Dry-run for a specific date without sending anything:

```bash
curl -s "https://fran-hrm-lime.vercel.app/api/v1/scheduling/reminders/run?date=2026-09-04&dry_run=1" \
  -H "Authorization: Bearer <CRON_SECRET>"
```

A manager can also press **Run today's reminders** on Scheduling truth
(their workspace only). Reminders are idempotent — one per person per
(month, token) — so pressing it twice is safe.

### 7. Pilot channel (optional)

Create a private group or channel for the pilot participants, add the bot,
and note the chat id (add @RawDataBot or use `getUpdates`). Put it in
`TELEGRAM_PILOT_CHAT_ID`. The P0 bot does not post to it yet; it is where
P2 "urgent cover" blasts will go.

## How staff link

Tell participants: open the bot, send

```
/link <employee code> <PIN>
```

using the same code and PIN they sign in to FranHRM with. The link shows as
**linked** on Scheduling truth. `/unlink` removes it; a manager can also
delete the row in `staff_telegram_links`.

## What the bot can and cannot do (P0)

- Can: link identity, show the open month and lock date (from Scheduling
  rules), submit/amend availability through the same core function as the web
  form (same cutoff, same manager locks, same rules lock), show what was
  submitted, receive reminders and "roster published" messages.
- Cannot: swap or claim cover (P1/P2), see anyone else's data, publish, or
  change rules. Chat history is never the source of truth — everything is a
  row in FranHRM.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Bot never replies | `getWebhookInfo` — is `url` set? Any `last_error_message`? Vercel function logs for `[telegram]`. |
| `[telegram] TELEGRAM_BOT_TOKEN is not set` in logs | Env var missing on the deployment you are hitting; redeploy after adding. |
| Webhook returns 401 | `secret_token` mismatch — re-run setWebhook with the value on Vercel. |
| `/link` says code and PIN do not match | Same rules as web login: active staff, correct PIN, 5 failures = 15-minute lockout. |
| `/avail` says the month closed | Rules lock. Change **Scheduling rules → Locks at end of day** or have a manager enter it on Availability. |
| Reminders did nothing | Nothing due today per the rules, or already sent (see `skipped_duplicate` in the response). Use `?date=…&dry_run=1` to inspect a day. |
