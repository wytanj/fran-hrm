# SSO → create-workspace onboarding (the method)

**As of:** 2026-08-12
**Decisions:** create a workspace = restricted to an allowlist; joining an existing workspace = invite-only; **finance** is a first-class role; one workspace per Google account for now.

**Create-workspace allowlist (env-configurable, comma-separated domains + emails):**
`WORKSPACE_CREATE_ALLOWLIST = heyfran.com, wytanj@gmail.com`
- `heyfran.com` — the domain: any `@heyfran.com` Google account can create the real org and invite finance/managers.
- `wytanj@gmail.com` — explicit address: a throwaway **sandbox** workspace to dump and try things. Fully isolated from the heyfran.com workspace by design.

Two *different* accounts → two workspaces, so "one workspace per account" holds. Keeping the allowlist in env means adding/removing testers needs no deploy.

## Model

Google (via Supabase Auth) proves *who the person is*. A `staff` row links that identity (`staff.auth_user_id`) to **one** workspace with **one** role. Floor staff stay on **code + PIN** (`auth_user_id` null) — dual auth. Scopes always come from the role in the editable matrix; the workspace is always resolved from the staff row, **never** from client input (the isolation guarantee).

## The single decision on every SSO login

```
Continue with Google → /auth/confirm
      │
      ├─ auth_user_id already a member?        → enter their workspace
      ├─ email matches a pending invite?       → accept → create/link staff with the invited role → enter
      ├─ email is an existing PIN staff?       → link auth_user_id to that row (no duplicate) → enter
      └─ none, and email is allowlisted?       → “Create your organization” → new workspace,
      │                                           creator becomes hq_admin, seed matrix + first store
      └─ none, not allowlisted?                → “Ask an owner to invite you”
```

## Roles / finance

Finance sees everything relevant to pay and can **lock payroll**, but edits no rosters/staff and approves no leave. Default scopes: `staff:read, org:read, roster:read, roster:history, attendance:read, leave:read, reports:read, reports:cost, payroll:lock`. Multiple admins per workspace are normal (hq_admin + finance + managers).

## Foolproofing (edge cases handled)

- Existing PIN staff with the same email → **link**, never duplicate.
- Invite: case-insensitive email, single live invite per email/workspace, expiry, already-accepted.
- Workspace creation is **idempotent** (a refresh can't create two); wrapped so workspace + owner + matrix seed land together.
- A Google user with no invite and no membership can only create **their own** org (if allowlisted) — never slip into someone else's.
- Can't remove the last `hq_admin` from a workspace.

## Build stages

**Stage 1 — foundation (done, migrations 016/017):** `staff.auth_user_id`, `workspaces.created_by`, `workspace_invites`, the `finance` role + its default permissions. Additive; nothing uses it until Stage 2.

**Stage 2 — auth wiring (needs `SUPABASE_ANON_KEY` in `.env` + Vercel):**
1. Add `@nuxtjs/supabase`; configure Google redirect; keep `/login` (PIN) for floor.
2. `/auth/login` (Google button) + `/auth/confirm` callback.
3. Dual-auth in `requireActor` / `getSessionStaff` / `useSession` / middleware: accept a Supabase session (map `auth_user_id` → staff → workspace) **or** the PIN cookie. Set `access_method` = `sso` on SSO login.
4. Membership resolver + the login decision above; `create-workspace` and `accept-invite` endpoints (allowlist-gated create).
5. Invite UI (admin invites email + role) → `/invite/{token}`.
6. Verify end-to-end with a real Google login **before** it touches the live PIN path; then deploy.

## What the owner still needs to do

1. Add the Supabase **anon / publishable key** as `SUPABASE_ANON_KEY` in `.env` and Vercel → Project Settings → Environment Variables. `SUPABASE_URL` is already set. Google provider + OAuth client are configured on the Supabase/Google side.
2. Set `WORKSPACE_CREATE_ALLOWLIST=heyfran.com,wytanj@gmail.com` (env, both `.env` and Vercel). Add more testers here anytime without a deploy.
