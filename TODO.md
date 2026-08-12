# FranHRM — TODO

_Last updated: 2026-08-11_

## 🔴 In progress — SSO → create-workspace (multi-tenant)

Google (Supabase Auth) for admins/managers/finance; **code+PIN kept** for floor. Create a workspace = restricted (`heyfran.com` + allowlist); joining = invite-only; **finance** is a first-class role; one workspace per Google account for now. Full method + edge cases: [docs/SSO_WORKSPACE_ONBOARDING.md](docs/SSO_WORKSPACE_ONBOARDING.md).

**Stage 1 — foundation (DONE, migrations `016`/`017`):**
- [x] `staff.auth_user_id`, `workspaces.created_by`, `workspace_invites` table
- [x] `finance` role added to the enum + catalog + default matrix + seeded into the existing workspace
- [x] `access_method` indicator already in place (mig `015`) — SSO login → `sso`, accepted invite → `otp`

**Stage 2 — auth wiring (BLOCKED on owner adding `SUPABASE_ANON_KEY` + `WORKSPACE_CREATE_ALLOWLIST=heyfran.com,wytanj@gmail.com` to `.env` + Vercel):**
_(Two workspaces planned: heyfran.com = real; wytanj@gmail.com = throwaway sandbox. Isolated by design.)_
- [ ] Add `@nuxtjs/supabase`; wire client (Google redirect); keep `/login` PIN for floor
- [ ] `/auth/login` (Google) + `/auth/confirm` callback
- [ ] Dual-auth in `requireActor` / `getSessionStaff` / `useSession` / middleware (Supabase session ↔ PIN cookie; map `auth_user_id` → staff → workspace; set `access_method='sso'`)
- [ ] Membership resolver + login decision (member / invite / existing-PIN link / create-if-allowlisted / else "ask an owner")
- [ ] `create-workspace` (allowlist-gated) + `accept-invite` endpoints; invite UI (`email+role → /invite/{token}`)
- [ ] Point the MCP/Claude connector sign-in at the Google session
- [ ] Verify end-to-end with a real Google login **before** it touches the live PIN path; then deploy

**Note:** migrations `012`–`017` are taken. Finance UI currently rides `ROLE_LEVEL` (manager-level visibility); moving the manager UI gates from role-level to scope-based is a follow-up so finance sees exactly its permitted screens.

## ✅ Recently done (all deployed to fran-hrm-lime)
- **Staff status indicators** — (1) simulated staff now **excluded from hours/cost reports + exports by default**, with an "Include simulated" toggle (`?include_dummy=true` on REST hours/attendance; `include_dummy` on MCP `attendance_summary`); (2) **access-method tag** for real staff — `staff.access_method` (mig `015`: `sso`/`otp`/`pin`, default `pin`), shown as an SSO/OTP/PIN pill on Team. Data-model indication only; OTP (Twilio) + SSO sign-in flows land with the SSO epic. "Dummy" box relabelled **Simulated staff**.
- **Dummy (test) staff** — `staff.is_dummy` (mig `014`); create via Team → Testing tools (auto `DUMMY-xxxx` code, PIN 123456) or `POST /staff {is_dummy:true}`; **"Dummy" tag** beside the name on Team, Roster (matrix+mobile) and Reports; dummy-only hard purge (`DELETE /staff/:id`) + **Remove all** (`POST /staff/purge-dummies`) — real staff can't be hard-deleted.
- **Weekly timesheet sign-off** — per store-week sign-off (mig `013` `timesheet_weeks`), **overdue** flag (unsigned past week_end+7d), **soft edit-past-close** (reason + logged + week re-flagged `amended`) wired into corrections-approve, **CSV+JSON** export on hours (attendance already had CSV), `timesheet_status` MCP tool, Sign-off tab on `/reports`, help article. (`2a09f42`)
- **Reverse-scan check-in** — staff show a rotating personal QR (`/api/v1/clock/my-qr`, 60s signed token), a supervisor's **Check-in scanner** (`/clock-scan`) reads it; clock endpoint gains a reverse mode (attendance:write). Attended = the witness is the security control. Floor path only; independent of SSO. (`a5ffd5c`)
- Roster **change history** for adjustments/disputes — data model (mig `012`) + REST + MCP (`roster_history`) + GUI timeline + optional adjustment reason + `roster:history` matrix permission + help article. (`5635280`)
- `/roster` load latency — parallelized the SSR fetch waterfall, dropped a duplicate templates fetch. (`5635280`)
- Roster builder Generate tab — proposal grid read the wrong key (`grid` vs `table`). (`8a04180`)

## 🔒 Pre-launch hygiene (before real testers)
- [ ] Rotate seeded demo PIN `123456` for the admin account (public URL = anyone can sign in as `HQ001`/hq_admin), or move admins to Google SSO
- [ ] Create owner admin account `wytanj@gmail.com` (hq_admin)
- [ ] (Optional) relabel seeded store Orchard → Bugis+; prune fake demo staff
- [ ] Set the permission matrix for the roles you'll hand out
