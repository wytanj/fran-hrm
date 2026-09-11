---
slug: scheduling-truth-and-telegram
title: Monthly availability window, the Telegram bot, and the truth panel
summary: Availability for next month opens and locks on fixed days; submit it on Telegram or the web; managers see who is missing on Scheduling truth.
category: scheduling
primary_path: /scheduling-truth
related_paths: [/scheduling-rules, /availability, /roster]
intent_tags: [telegram, telegram bot, link telegram, /link, /avail, /status, availability bot, when does availability open, when does availability close, lock day, locked month, availability locked, month locked, reminder, reminders, who has not submitted, missing availability, scheduling truth, scheduling rules, rules version, open window, submit availability by, cutoff date for next month, october availability, next month availability]
sort_order: 41
---

# Monthly availability window, the Telegram bot, and the truth panel

## The window

Availability for a month is collected during the **previous** month, between
two fixed days set on **Scheduling rules**. With the defaults:

- **Opens** on the 1st of the prior month (October availability opens 1 September).
- **Locks** at the end of the 7th of the prior month. From the 8th you cannot
  change that month yourself — ask your manager, who can still edit it.
- Rosters for the month are meant to be published by the 15th.

You get reminders in the bell (and on Telegram if linked): when the window
opens, 3 days and 1 day before it locks if you have not submitted, and when
it locks. The exact days are on Scheduling rules; managers can change them
and the change applies immediately.

If you submit nothing, you are scheduled as **available** for the whole
month. Approved leave still blocks those days.

The usual 7-day cutoff still applies as well — you cannot edit a day that is
less than a week away even inside an open window.

## Submitting on Telegram

1. Open the FranHRM availability bot (your manager will share the link).
2. Send `/link <employee code> <PIN>` — the same code and PIN you sign in with.
   The bot deletes that message afterwards.
3. `/status` shows which month is open, when it locks, and how many days you
   have submitted.
4. Send days, one per line. Examples:

   ```
   /avail 3 oct cant
   /avail 2026-10-04 can 10:00-18:00
   /avail oct 6-8 prefer
   ```

   Kinds: `can` (can work), `prefer`, `cant` (can't). A time window is
   optional and only applies to can/prefer.

5. `/mine` lists everything you have submitted for the open month. Sending
   a day again replaces it.

The bot writes to the same place as the Availability page, with the same
rules: it will refuse a day that is past the cutoff, inside a locked month,
or locked by your manager, and tell you why. If your role does not need
day-by-day availability the bot says so.

`/unlink` disconnects your Telegram. Nobody else can see your data through
the bot; every action is tied to your linked staff record.

## Scheduling truth (supervisors and managers)

**Scheduling truth** answers, for one month and optionally one store:

- Who must submit (the per-person "availability required" flag), who has,
  and who is **missing** — highlighted, and red once the window has locked.
- Whether the window is open or locked, and any per-date manager locks.
- Approved and pending leave in the month, so a gap is not mistaken for a
  free person.
- Which roster weeks exist, draft or published, with shift and open-shift
  counts.
- Who has linked Telegram.

**Run today's reminders** sends whatever is due today under the rules; it is
safe to press twice (one reminder per person per trigger).

## Scheduling rules (supervisors and managers)

The rulebook the bot, reminders and the lock all follow. Editing needs the
"Build rosters for others" permission. Saving bumps the version and is
audited; "Reset to file defaults" returns to the version in git.
