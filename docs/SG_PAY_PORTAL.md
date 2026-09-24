# SG staff pay portal + statutory timeline

## Staff magic link
- Column `staff.pay_portal_token` (stable). Issue/rotate: `POST /api/v1/staff/:id/pay-portal-token` (`staff:write`).
- Public UI: `/pay/:token` (no session). APIs under `/api/pay/:token/*`.
- **Token validity (JT/CoS):** resolves for `active`, `inactive` (soft break), and `terminated` (formal exit) as long as the token matches and has not been explicitly rotated. Leave/rejoin keeps the same `staff_id` / NRIC — never hard-delete, never a second seat.
- **Live estimate + month preview:** only when `employment_status === 'active'` **and** payroll-eligible (`payroll_eligible_from` / hire gates via `isPayrollEligibleAsOf`). Inactive/terminated see issued/acknowledged payslip history only.
- **Kill switch:** `revokePayPortalToken` / `rotate: true` only. Terminate and soft-break must **not** auto-rotate the token. Reactivation = flip status to `active` (+ home_store / hired_on as needed); same token keeps working.

## MCP / fran-bird
- Tool `payroll_earnings_month` `{ staff, month? }` → schema `fran-hrm.payroll_earnings_month.v1` (same JSON as the portal estimate/month endpoints).

## Statutory timeline
- Table `sg_statutory_timeline` — **append-only**. Never update historical payloads; insert a new `effective_from`.
- Kinds: `cpf_band`, `ow_ceiling`, `aw_ceiling`, `shg_rate`, `sdl_rate`, `ot_multiplier`, `note`.
- Helpers: `core/payroll/statutory.mjs` (`appendStatutoryRate`, `lookupStatutoryRate`, `previewStatutory`).

## New staff fields (migration 032)
`religion`, `shg_opt_out`, `work_pass_type|no|expires_on`, `pr_cpf_type` (`FG`|`GG`), `bank_bic`, `bank_account_name`, `pay_portal_token`.

## Payroll eligible (migration 033, already on branch)
`staff.payroll_eligible_from` + `staff_hire_gates`. Helpers in `core/payroll/eligibility.mjs` (`resolveEligibleFrom`, `isPayrollEligibleAsOf`, `gatesBlockPay`). No new column added for this pay-home gate.

## Out of scope
WhatsApp. Draft-first PRs only. Timeline fallback rates are **preview only** — not Board-official for ezPay filing until finance seeds the timeline.