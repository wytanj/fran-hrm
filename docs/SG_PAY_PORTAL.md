# SG staff pay portal + statutory timeline

## Staff magic link
- Column `staff.pay_portal_token` (stable). Issue/rotate: `POST /api/v1/staff/:id/pay-portal-token` (`staff:write`).
- Public UI: `/pay/:token` (no session). APIs under `/api/pay/:token/*`.
- Shows payslip history + live estimate (PT = current week; FT = MTD basic + store OT as Additional Wages) with CPF/SHG preview.

## MCP / fran-bird
- Tool `payroll_earnings_month` `{ staff, month? }` → schema `fran-hrm.payroll_earnings_month.v1` (same JSON as the portal estimate/month endpoints).

## Statutory timeline
- Table `sg_statutory_timeline` — **append-only**. Never update historical payloads; insert a new `effective_from`.
- Kinds: `cpf_band`, `ow_ceiling`, `aw_ceiling`, `shg_rate`, `sdl_rate`, `ot_multiplier`, `note`.
- Helpers: `core/payroll/statutory.mjs` (`appendStatutoryRate`, `lookupStatutoryRate`, `previewStatutory`).

## New staff fields (migration 032)
`religion`, `shg_opt_out`, `work_pass_type|no|expires_on`, `pr_cpf_type` (`FG`|`GG`), `bank_bic`, `bank_account_name`, `pay_portal_token`.

## Out of scope
WhatsApp. Draft-first PRs only. Timeline fallback rates are **preview only** — not Board-official for ezPay filing until finance seeds the timeline.
