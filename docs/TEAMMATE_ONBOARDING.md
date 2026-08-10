# Teammate onboarding — FranHRM

**As of:** 2026-08-11
**Goal:** Invite real people into the demo workspace by link; dashboard users sign in with **Google SSO**, floor staff keep **code + PIN**. Test uses `heyfran.com` + specific personal Gmails; production later locks to `heyfran.com`.

> **Status:** Google SSO + invite-accept is being built (dual-auth). Until it ships, the interim path is admin-provisioned **code/email + PIN** at `/login`. Sections marked _(pending)_ light up when the SSO build lands.

## Mental model

| Who | Auth | Join path |
|-----|------|-----------|
| **Dashboard / office** (you, managers, `jarell@heyfran.com`) | **Google SSO** _(pending)_ | Invite link → `/invite/{token}` → Continue with Google |
| **Floor staff** (clock-in on the tablet) | **Code + PIN** (unchanged) | Admin creates the staff record; QR clock uses PIN |

Scopes always come from the person's **staff role** in the permission matrix — Google only proves *who* they are. One workspace (the seeded one); nobody creates a second.

**Do not mix:** Google = dashboard people; PIN = floor clocking. Same rule as fran-skums (Team vs Staff PIN).

## One-time platform setup (admin, external — not in this repo)

1. **Google Cloud Console** → APIs & Services → Credentials → **Create OAuth client** (Web).
   - Authorized redirect URI: `https://<fran-hrm-supabase-ref>.supabase.co/auth/v1/callback`
   - Copy **Client ID** + **Client secret**.
2. **Supabase dashboard** (fran-hrm project) → Authentication → Providers → **Google** → paste ID/secret, enable.
   - Site URL: `https://fran-hrm-lime.vercel.app`; add it under Redirect URLs.
3. **Anon / publishable key**: Project Settings → API. Add to `.env` and Vercel as `SUPABASE_ANON_KEY` (client-safe).
4. **Allowed accounts:** invite-gated. An unknown Google email lands on "ask an owner to invite you." Test allows `heyfran.com` + listed Gmails; production narrows to `heyfran.com`.

## Admin steps — invite a teammate _(pending)_

1. **Team** → **Invite** → enter email + role → **Create link**.
2. Copy the `/invite/{token}` link and send it (no mailer — share it directly).
3. Role picked here is what grants scopes (incl. **View roster change history**). Choose deliberately: `store_manager`, `supervisor`, `staff`, …

## Invitee steps _(pending)_

1. Open the invite link.
2. **Continue with Google** using the **exact invited email**.
3. Land in the workspace with the role from the invite.
4. To use Claude: open the connector invite (`/connect-claude`), authorize — tools are scoped to the same role.

## Floor staff (live now)

Create the staff record (role `staff`, employment type, home store). They clock in with **employee code + PIN** on the tablet / `/clock`. No Google account needed. This path is unchanged by the SSO work.

## Security notes

- Seeded demo accounts all share PIN **`123456`** and the URL is public — anyone with it can sign in as any seeded account, **including the hq_admin (`HQ001` / `ava@fran.sg`)**. Before real testing, rotate at least the admin PIN, or convert admins to Google SSO.
- Invites carry a role and expire (default 7 days). Revoke by expiring/deleting the invite row.
- Changing someone's role or terminating them re-derives scopes on their next request — through the web app **and** Claude.

## Migrations

| Purpose | File |
|---|---|
| Invite table (`workspace_invites`) + accept binding | `core/db/013_*.sql` _(added with the SSO build)_ |

Run `npm run db:migrate` (checksummed; never edit an applied file).
