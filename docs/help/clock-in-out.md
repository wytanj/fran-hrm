---
slug: clock-in-out
title: Clocking in and out
summary: Scan the store QR to clock in. Clocking out and breaks need no rescan.
category: attendance
primary_path: /clock
related_paths: [/]
intent_tags: [clock in, clock out, qr code, punch in, break, scan, start shift, end shift]
sort_order: 10
---

# Clocking in and out

## Clock in

1. Open **Clock** in FranHRM.
2. Scan the QR code displayed at your store counter (or type the code shown under it).
3. Tap **Clock in**.

The QR code **changes every day**. Yesterday's code will not work — that is deliberate, it stops off-site clocking.

## Breaks

Once you are clocked in, use **Start break** and **End break**. Break minutes are subtracted from your worked hours automatically. If you forget to end a break, clocking out closes it for you.

## Clock out

Tap **Clock out**. You do not need to scan again — being clocked in already proves you were at the store.

## What gets flagged

The system compares your actual times against your published shift. A variance beyond the grace period (5 minutes by default) raises a flag for your supervisor:

- **late** — clocked in more than 5 minutes after your shift start
- **early_in** / **early_out** — clocked in or out more than 5 minutes early
- **late_out** — clocked out well after your shift end
- **unscheduled** — you clocked in on a day with no published shift
- **ot_daily** — the day exceeded the daily overtime threshold

A flag is not a penalty. It is a note for your manager to review, and often the explanation is routine (covering for someone, closing late).

## If something is wrong

Do not ask someone else to clock for you. File a correction instead — see [Fixing a missed or wrong clock](/help/time-corrections).
