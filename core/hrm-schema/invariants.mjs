// People-model invariants. Structured so the JSON snapshot and the verbose
// prose are generated from the SAME list — never two copies of "what Fran
// believes about a person".
//
// These are the rules the staff record, org chart, permissions and MCP tools
// already enforce. Changing one here without changing the code is a lie;
// schema:check exists so that drift is visible.

export const INVARIANTS = [
  {
    id: 'two-title-forms',
    topic: 'titles',
    statement: 'Every person has two titles. positions.title is internal/formal (payroll, contracts). positions.comms_title — or staff.comms_title if set — is what we say out loud. display_title is comms, falling back to formal. Never mix the two registers in one sentence.',
  },
  {
    id: 'hierarchy-seat-and-person',
    topic: 'hierarchy',
    statement: 'Reporting lines live on seats (positions.reports_to_id) AND optionally on the person (staff.reports_to_id). The person override wins, so an interim arrangement does not require rewriting the designed org. A vacant or multiply-held manager seat is reported, never guessed.',
  },
  {
    id: 'no-reporting-cycle',
    topic: 'hierarchy',
    statement: 'A reporting-line edit that would create a loop — including through a seat-derived manager — is refused. A loop makes the chart and every manager query unresolvable.',
  },
  {
    id: 'one-accountable-owner',
    topic: 'accountability',
    statement: 'Exactly one accountable owner per accountability. Owner attaches to a seat (survives turnover) with an optional owner_staff_id pin. The row may not have neither. A vacant or shared seat is a gap, not a fallback to a contributor.',
  },
  {
    id: 'contributors-are-separate',
    topic: 'accountability',
    statement: 'Contributors (contributor / consulted / informed) are a separate table from the owner. Collapsing them is how accountability becomes plural and therefore nobody\'s.',
  },
  {
    id: 'two-permission-layers',
    topic: 'permissions',
    statement: 'A scope answers what KIND of action. Actor identity answers WHOSE records. Both are required for personal data. A scope check alone is not enough. There is no hardcoded role floor for capability — the editable matrix is the rule.',
  },
  {
    id: 'write-means-others',
    topic: 'permissions',
    statement: '*:write means acts on other people. Self-service (own availability, own correction, own leave) runs on the matching *:read plus the identity check. Do not grant a staff member a write scope to "fix" a 403 on their own record.',
  },
  {
    id: 'sensitive-pay-and-pii',
    topic: 'permissions',
    statement: 'Pay, race, citizenship, home address, NRIC and bank ride reports:cost or staff:write. A directory read (staff:read) never carries them.',
  },
  {
    id: 'money-is-integer-cents',
    topic: 'money',
    statement: 'Money is integer cents. Monthly salary and hourly rate are stored as monthly_salary_cents and hourly_rate_cents. The UI may show dollars; the record does not.',
  },
  {
    id: 'dates-are-sgt-calendar',
    topic: 'time',
    statement: 'Dates are YYYY-MM-DD on the Singapore calendar. Times are timestamptz. Weeks start Monday. roster.week_start is always a Monday.',
  },
  {
    id: 'citizenship-three-values',
    topic: 'statutory',
    statement: 'Citizenship (staff.residency) is one of citizen (Singaporean), pr, or foreigner. That is what CPF EZPay uses. Nationality is a separate free-text field.',
  },
  {
    id: 'real-staff-are-terminated',
    topic: 'lifecycle',
    statement: 'Real staff are terminated, never hard-deleted, so timesheets and the audit trail survive. Only is_dummy rows may be purged. Termination revokes POS access; re-activation does not restore it.',
  },
  {
    id: 'departments-are-functions',
    topic: 'org',
    statement: 'Departments are org_functions. A person may belong to several (staff_departments); is_primary is the home. If none are set, the profile infers the seat\'s function so the chart and the record agree.',
  },
  {
    id: 'workspace-id-on-every-query',
    topic: 'tenancy',
    statement: 'Every query filters workspace_id. The app talks to Postgres as the service role; RLS is on with zero policies. Tenancy is enforced in code.',
  },
  {
    id: 'audit-every-mutation',
    topic: 'audit',
    statement: 'Mutations write audit_events (before/after). Audit insert failure is logged, never thrown — a write must not roll back because the trail failed.',
  },
  {
    id: 'custom-fields-do-not-shadow',
    topic: 'extensibility',
    statement: 'Workspace custom fields extend the staff record without a migration. Their key cannot shadow a built-in field. Built-in columns stay first-class because payroll, CPF and the org resolver query them.',
  },
]
