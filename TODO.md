# FranHRM — TODO

_Last updated: 2026-08-11_

## 🔴 In progress — Google SSO for teammates (dual-auth)

Onboard real people "fran-skums style": invite link + **Google SSO** for dashboard users, **keep code+PIN** for floor clocking. Invite-gated for `heyfran.com` + specific test Gmails. Runbook: [docs/TEAMMATE_ONBOARDING.md](docs/TEAMMATE_ONBOARDING.md).

**BLOCKED on external setup (owner, ~15 min — see runbook §"One-time platform setup"):**
1. [ ] Google Cloud → create OAuth Web client; redirect `https://<supabase-ref>.supabase.co/auth/v1/callback`
2. [ ] Supabase → Auth → Providers → Google: paste client id/secret, enable; Site URL `https://fran-hrm-lime.vercel.app`
3. [ ] Provide the Supabase **anon/publishable key** → add as `SUPABASE_ANON_KEY` (.env + Vercel)

**Build sequence (starts once unblocked; nothing deploys until verified against a real Google login):**
- [ ] Add `@nuxtjs/supabase` + anon key; wire client
- [ ] Migration `013`: `workspace_invites` (email, role, token, expiry, accepted binding)
- [ ] `/auth/login` (Google) + `/auth/confirm` callback; keep `/login` PIN for floor
- [ ] Dual-auth: `requireActor` / `getSessionStaff` / `useSession` / middleware accept Google session **or** PIN cookie; map Google email → staff role
- [ ] Invite create endpoint + accept/bind flow + Team invite UI (`email+role → /invite/{token}`)
- [ ] Gating: `heyfran.com` + test Gmails; unknown email → "ask an owner to invite you"
- [ ] Point MCP/Claude connector sign-in at the Google session
- [ ] Verify end-to-end, then commit + deploy

**Open decision:** mirror skums exactly (Supabase Auth + Google) — chosen — vs a lighter **custom Google OAuth** that keeps the existing session model (no Supabase Auth / no anon key). Revisit if enabling Supabase Auth is unwanted.

## ✅ Recently done
- **Reverse-scan check-in** — staff show a rotating personal QR (`/api/v1/clock/my-qr`, 60s signed token), a supervisor's **Check-in scanner** (`/clock-scan`) reads it; clock endpoint gains a reverse mode (attendance:write). Attended = the witness is the security control. Floor path only; independent of SSO.
- Roster **change history** for adjustments/disputes — data model (mig `012`) + REST + MCP (`roster_history`) + GUI timeline + optional adjustment reason + `roster:history` matrix permission + help article. (`5635280`)
- `/roster` load latency — parallelized the SSR fetch waterfall, dropped a duplicate templates fetch. (`5635280`)
- Roster builder Generate tab — proposal grid read the wrong key (`grid` vs `table`). (`8a04180`)

## 🔒 Pre-launch hygiene (before real testers)
- [ ] Rotate seeded demo PIN `123456` for the admin account (public URL = anyone can sign in as `HQ001`/hq_admin), or move admins to Google SSO
- [ ] Create owner admin account `wytanj@gmail.com` (hq_admin)
- [ ] (Optional) relabel seeded store Orchard → Bugis+; prune fake demo staff
- [ ] Set the permission matrix for the roles you'll hand out
