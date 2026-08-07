---
slug: signing-in
title: Signing in and PINs
summary: Sign in with your employee code and 6-digit PIN. Five wrong tries locks you out for 15 minutes.
category: account
primary_path: /login
intent_tags: [sign in, login, pin, password, locked out, forgot pin, cannot login, reset pin, access]
sort_order: 90
---

# Signing in and PINs

## Signing in

Use your **employee code** (e.g. `SM001`, `PT002`) or your work email, plus your **PIN**.

FranHRM accounts are separate from your POS register passcode. Changing one does not change the other — that is intentional, so losing a register PIN never exposes HR data.

## Lockouts

Five wrong PINs locks the account for **15 minutes**. Wait it out, or ask a manager to reset your PIN — a reset clears the lock immediately.

## Resetting a PIN

Area managers and HQ admins can set a new PIN for any staff member. PINs are 4–12 digits, stored hashed — nobody, including HQ, can read your existing PIN. If you have forgotten it, it has to be replaced rather than looked up.

## Sessions

Signing in lasts **14 days** on that device, then asks again. Use **Sign out** on a shared device — the next person would otherwise be able to see your hours and file requests as you.

## Leaving the company

When a staff record is set to terminated or inactive:

- FranHRM sign-in stops working immediately
- Any Claude connection stops working on its next request
- POS register access is revoked automatically

Re-activating an account does **not** automatically restore POS access — a manager restores that deliberately at the register.
