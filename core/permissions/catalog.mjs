// The permission catalog: every scope, what it lets someone do, and the
// defaults each role starts with. Shared by REST, MCP and the admin UI so the
// three never disagree about what a scope means.
//
// Scopes answer "what KIND of thing may this person do". They deliberately do
// NOT answer "whose records" — that is a separate identity check
// (limitToSelf / assertCanReadStaff), because a staff member holding
// attendance:write should be able to fix their OWN timesheet, not everyone's.

export const SCOPES = [
  { scope: 'staff:read', group: 'People', label: 'View the staff directory', detail: 'Names, codes, roles, titles, departments, reporting lines. Needed to pick a teammate for a swap. Open Team → a name for the profile.' },
  { scope: 'staff:write', group: 'People', label: 'Create and edit staff records', detail: 'Add hires, edit the full profile (pay, address, citizenship, custom fields), set PINs, terminate. Sensitive.' },
  { scope: 'staff:dummy', group: 'People', label: 'Create and manage dummy staff', detail: 'Create, edit, purge and "View as" simulated (dummy) staff — for modelling a prospective hire or seeding test data. Never touches a real person\'s record; separate from staff:write on purpose so a store manager can do this without full staff-editing rights.' },
  { scope: 'org:read', group: 'People', label: 'View org chart and accountabilities', detail: 'Seats, titles, reporting lines, the accountability register.' },
  { scope: 'org:write', group: 'People', label: 'Edit accountabilities and seats', detail: 'Create seats, move reporting lines, assign accountability owners, record check-ins.' },

  { scope: 'roster:read', group: 'Scheduling', label: 'View rosters', detail: 'Published rosters, and submit your own availability and swap requests. Draft visibility additionally needs roster:write.' },
  { scope: 'roster:write', group: 'Scheduling', label: 'Build rosters for others', detail: 'Create drafts, add/move/remove shifts, assign staff, decide swap requests, set anyone\'s availability.' },
  { scope: 'roster:publish', group: 'Scheduling', label: 'Publish rosters', detail: 'Makes a roster live for staff and drives attendance comparison. The consequential one.' },
  { scope: 'roster:history', group: 'Scheduling', label: 'View roster change history', detail: 'The audit trail of who changed which shift, when, and from what to what — for settling adjustments and disputes. Read-only.' },

  { scope: 'attendance:read', group: 'Attendance', label: 'View timesheets, and clock yourself', detail: 'Your own clock records and flags, plus requesting a correction on your own timesheet.' },
  { scope: 'attendance:write', group: 'Attendance', label: 'Manage others\' attendance', detail: 'Approve corrections, key manual clock entries, import the offline sheet, show the store QR, review flags.' },

  { scope: 'leave:read', group: 'Leave', label: 'View leave and balances', detail: 'Requests and entitlement balances.' },
  { scope: 'leave:write', group: 'Leave', label: 'Submit leave requests', detail: 'File a request. Approval is a separate permission.' },
  { scope: 'leave:approve', group: 'Leave', label: 'Approve or reject leave', detail: 'Debits the balance and blocks roster slots.' },

  { scope: 'reports:read', group: 'Reporting', label: 'View hours and attendance reports', detail: 'Worked hours, OT, adherence exports.' },
  { scope: 'reports:cost', group: 'Reporting', label: 'See pay rates and manpower cost', detail: 'Hourly rates, monthly salary, race, citizenship, home address, NRIC, and cost-per-store figures. Treat as confidential.' },

  { scope: 'payroll:lock', group: 'Payroll', label: 'Approve, lock and reopen pay periods', detail: 'Locking makes timesheets read-only; reopening a paid period needs care.' },
  { scope: 'payroll:settings', group: 'Payroll', label: 'Manage CPF & pay settings', detail: 'CPF/EOR configuration and pay settings (Singapore). Finance and HQ only — every change is logged to the control plane.' },
  { scope: 'payroll:process', group: 'Payroll', label: 'Process payroll & EOR runs', detail: 'Run payroll and submit to the Employer of Record. Financial processing — Finance and HQ only.' },

  { scope: 'zones:read', group: 'Stores', label: 'View store zones and layouts', detail: 'The mapped zones of a store floor — for scheduling, analytics and (later) vision models.' },
  { scope: 'zones:write', group: 'Stores', label: 'Create and edit store zones', detail: 'Draw and name the zones of a store layout. Store managers and above.' },

  { scope: 'hrm_schema:read', group: 'Admin', label: 'View the in-force people schema', detail: 'The versioned HRM people policy (JSON + prose) — what Fran is actually running.' },
  { scope: 'hrm_schema:write', group: 'Admin', label: 'Publish a people-schema version', detail: 'Snapshot the git catalogs and put a version in force. HQ only by default.' },

  { scope: 'connector:manage', group: 'Admin', label: 'Manage the Claude connector', detail: 'Generate OAuth credentials, invite staff, disconnect people.' },

  { scope: 'pos:sync', group: 'Integrations', label: 'Pull the staff directory for POS', detail: 'Machine-to-machine only; not meaningful for a person.' },
]

export const SCOPE_KEYS = SCOPES.map((s) => s.scope)

export const ROLES = ['staff', 'supervisor', 'store_manager', 'area_manager', 'finance', 'hq_admin']

export const ROLE_LABELS = {
  staff: 'Staff',
  supervisor: 'Supervisor',
  store_manager: 'Store Manager',
  area_manager: 'Area Manager',
  finance: 'Finance',
  hq_admin: 'HQ Admin',
}

/**
 * Fallback matrix, used only when a workspace has no rows at all (a fresh DB
 * before the migration seed, or a workspace created later). Once rows exist
 * they are authoritative and a missing row means denied — otherwise revoking a
 * permission in the UI would be silently undone by this default.
 */
export const DEFAULT_ROLE_MATRIX = {
  // No *:write for staff — self-service runs on the matching :read plus the
  // identity check. See core/db/010_permissions_split_self_service.sql.
  staff: ['staff:read', 'org:read', 'roster:read', 'attendance:read', 'leave:read', 'leave:write', 'reports:read'],
  supervisor: ['staff:read', 'org:read', 'roster:read', 'roster:write', 'roster:history', 'attendance:read', 'attendance:write', 'leave:read', 'leave:write', 'reports:read', 'zones:read'],
  store_manager: ['staff:read', 'staff:dummy', 'org:read', 'org:write', 'roster:read', 'roster:write', 'roster:publish', 'roster:history', 'attendance:read', 'attendance:write', 'leave:read', 'leave:write', 'leave:approve', 'reports:read', 'zones:read', 'zones:write'],
  area_manager: ['staff:read', 'staff:write', 'staff:dummy', 'org:read', 'org:write', 'roster:read', 'roster:write', 'roster:publish', 'roster:history', 'attendance:read', 'attendance:write', 'leave:read', 'leave:write', 'leave:approve', 'reports:read', 'reports:cost', 'payroll:lock', 'zones:read', 'zones:write'],
  // Finance: sees everything relevant to pay, locks payroll, and owns the
  // financial processing (CPF/pay settings + EOR runs). Edits no rosters/staff
  // and approves no leave.
  finance: ['staff:read', 'org:read', 'roster:read', 'roster:history', 'attendance:read', 'leave:read', 'reports:read', 'reports:cost', 'payroll:lock', 'payroll:settings', 'payroll:process', 'zones:read'],
  hq_admin: [...SCOPE_KEYS.filter((s) => s !== 'pos:sync')],
  // hrm_schema:* is HQ-only in the fallback too — not a seniority ladder.
}

/** Scopes that meaningfully change data or expose sensitive figures. */
export const SENSITIVE_SCOPES = [
  'staff:write', 'org:write', 'roster:publish', 'attendance:write',
  'leave:approve', 'reports:cost', 'payroll:lock', 'payroll:settings',
  'payroll:process', 'connector:manage', 'hrm_schema:write',
]

export function scopeMeta(scope) {
  return SCOPES.find((s) => s.scope === scope) || null
}
