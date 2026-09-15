# POS ↔ HRM auth API (P0)

Base: fran-hrm `/api/v1/pos/*`  
Auth: `Authorization: Bearer sk_live_…` or session cookie (hire/disable).

## `POST /api/v1/pos/verify`
Scopes: `pos:verify` **or** `pos:sync`

```json
{ "employee_code": "E12345", "pin": "12345678", "store_code": "FRAN01", "register_id": "REG-01", "device_token": "…" }
```

**200**
```json
{ "ok": true, "staff": { "id": "…", "employee_code": "E12345", "display_name": "…", "role": "staff", "employment_type": "full_time", "home_store_id": "…", "pos_access_enabled": true, "pin_expires_at": "…", "store_codes": ["FRAN01"] } }
```

Errors: `401` bad pin / inactive · `403` disabled / expired / store mismatch · `423` lockout · `400` pin not 8 digits.

## `POST /api/v1/pos/hire-approve`
Session/API with `staff:write` | `staff:invite` | `leave:approve` | `pos:disable`

```json
{ "employee_code": "E12345", "decision": "approve" }
```
`decision`: `approve` | `reject` | `hold`

On **approve**: sets `pos_access_enabled`, issues **8-digit** PIN (bcrypt), `pin_expires_at` = now+12m, returns one-time `pin` in body (`delivery: one_time_response`).

## `POST /api/v1/pos/disable`
Same judgment scopes; **requires** `"confirm": true`. Store managers scoped to their store; area/HQ unrestricted in workspace.

Clears `pos_access_enabled`, nulls `pin_hash` / expiry, ends `staff_sessions`, writes `pos_auth_events.disable`.

## Audit
Table `pos_auth_events`: `unlock_ok` | `unlock_fail` | `hire_approve` | `hire_reject` | `hire_hold` | `disable`.
