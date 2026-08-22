// FranHRM MCP tools: definitions (hand-written JSON Schema, advisory to the
// model) + handleTool() dispatch. Handlers delegate to core/* query modules —
// the same code the REST API runs, so agents and the web app always agree.
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import {
  actorIsRankAndFile, assertCanReadStaff, assertManagerView,
  errorResult, getDb, getMcpActorRole, getMcpActorStaffId, getMcpClientName,
  getMcpScopes, jsonResult, requireScope, requireWorkspaceId,
} from './context.mjs'
import { TOOL_SCOPE_CATALOG, resolvePermittedTools } from './toolScopes.mjs'
import { listStaff, resolveStaff, resolveStore, listStores } from '../../core/staff/query.mjs'
import {
  canSeeSensitiveFields, createStaffRecord, deleteCustomField, deleteStaffRecord,
  getStaffProfile, listCatalog, updateStaffRecord, upsertCustomField,
} from '../../core/staff/profile.mjs'
import {
  compactVersion, ensureInForce, getVersion, listVersions, presentVersion, publishVersion, snapshotCurrent,
} from '../../core/hrm-schema/store.mjs'
import { readGitMeta } from '../../core/hrm-schema/git.mjs'
import { getRoster, listShifts, listAvailability, listAvailabilityLocks, setAvailabilityLocks } from '../../core/roster/query.mjs'
import { listTemplates, upsertTemplate, deactivateTemplate } from '../../core/roster/templates.mjs'
import { validateConstraints, explainConstraints } from '../../core/roster/constraints.mjs'
import { formatRoster } from '../../core/roster/export.mjs'
import {
  applyRun, generateProposal, importCommit, importPreview, loadPlanningContext, mondayOf,
} from '../../core/roster/intake.mjs'
import { hoursWorked, attendanceSummary, listTimeEntries, listFlags } from '../../core/attendance/query.mjs'
import { listTimesheetWeeks } from '../../core/attendance/signoff.mjs'
import { listLeaveTypes, listLeaveRequests, getLeaveBalances, leaveDaysBetween } from '../../core/leave/query.mjs'
import { resolveHelp, getHelpArticle, listHelpArticles } from '../../core/help/resolve.mjs'
import {
  accountabilitiesForStaff, buildOrgTree, getAccountability, listAccountabilities,
  listPositions, listStaffOrg, resolveAllReports, resolveDirectReports,
  resolveManager, resolveReportingChain, searchAccountabilities,
} from '../../core/org/query.mjs'
import { recordAudit } from '../../core/audit/record.mjs'
import { rosterHistory } from '../../core/audit/history.mjs'
import { getPayrollSettings, updatePayrollSettings, payrollSettingsHistory } from '../../core/payroll/settings.mjs'
import { computeMonthlyProration } from '../../core/payroll/compute.mjs'
import { listZones } from '../../core/zones/query.mjs'

// Mirrors server/utils/scopes.ts ROLE_LEVEL — mcp/src runs standalone
// (node mcp/src/index.mjs) so it can't import that .ts file directly.
const ROLE_LEVEL = { staff: 1, supervisor: 2, store_manager: 3, area_manager: 4, finance: 4, hq_admin: 5 }
function roleAtLeast(role, min) {
  return (ROLE_LEVEL[role] || 0) >= (ROLE_LEVEL[min] || 99)
}

const DATE = { type: 'string', description: 'YYYY-MM-DD' }
const STAFF_REF = { type: 'string', description: 'Staff reference: uuid, employee code (e.g. PT001), or a unique name fragment' }
const STORE_REF = { type: 'string', description: 'Store reference: uuid or store code (e.g. FRAN01)' }

/** @type {Array<{name: string, description: string, inputSchema: object}>} */
export const toolDefinitions = [
  {
    name: 'capabilities',
    description: 'List the tools this connection is permitted to call, with the scope each needs. Call this first when unsure what you may do.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'help_search',
    description:
      'ALWAYS use this for "how do I…", "what is the policy on…", "am I allowed to…" questions about FranHRM — rosters, clocking, corrections, leave, OT, payroll lock, connecting Claude. Returns the CURRENT documented policy with steps and a /help link. Prefer it over answering from memory: the rules change and this content is maintained with the code. Example: {"query": "forgot to clock out"}.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "The user's question, in their own words" },
        limit: { type: 'number', description: 'Default 5, max 10' },
      },
      required: ['query'],
    },
  },
  {
    name: 'help_get',
    description: 'Read a full help article by slug (use after help_search when you need the whole article). Slugs: clock-in-out, time-corrections, leave-requests, availability-and-swaps, overtime-and-hours, roster-publish, offline-fallback, connect-claude, signing-in, payroll-lock, staff-profiles, org-and-accountability, permissions, hrm-schema.',
    inputSchema: { type: 'object', properties: { slug: { type: 'string' } }, required: ['slug'] },
  },
  {
    name: 'help_list',
    description: 'List every help article (slug, title, summary, category). Use to orient yourself or when help_search finds nothing.',
    inputSchema: {
      type: 'object',
      properties: { category: { type: 'string', description: 'attendance | scheduling | leave | payroll | account | claude' } },
      required: [],
    },
  },
  {
    name: 'stores_list',
    description: 'List Fran stores/locations (code, name, kind store|hq, timezone).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'zones_list',
    description: 'The mapped zones of a store floor — name, code, colour and position (as percentage rectangles). Use for scheduling by zone and retail analytics.',
    inputSchema: { type: 'object', properties: { store: STORE_REF }, required: ['store'] },
  },
  {
    name: 'org_chart',
    description:
      'The org chart: seats (positions) as a tree with their holders and vacancies. Each seat has BOTH titles — `title` is the internal/formal one ("Store Supervisor") and `comms_title` is what we actually say ("Shift Captain", "Marketing Girlie"). Use display_title when writing anything a person will read.',
    inputSchema: {
      type: 'object',
      properties: { include_inactive: { type: 'boolean', default: false } },
      required: [],
    },
  },
  {
    name: 'org_reporting',
    description:
      "One person's place in the org: their seat and titles, their manager, direct reports, everyone beneath them, the chain up to the top, and what they are accountable for. This is the tool for \"who does X report to\", \"who's on Y's team\", and for building 1:1 or team-meeting invite lists.",
    inputSchema: { type: 'object', properties: { staff: STAFF_REF }, required: ['staff'] },
  },
  {
    name: 'who_owns',
    description:
      'ACCOUNTABILITY LOOKUP: "who is accountable for stock accuracy / the roster going out / payroll?" Searches the accountability register in plain language and names the single accountable person (resolved through their seat). Use this instead of guessing from job titles — a title is not an accountability.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The outcome in the asker\'s own words' },
        limit: { type: 'number', description: 'Default 5' },
      },
      required: ['query'],
    },
  },
  {
    name: 'accountability_list',
    description:
      'The accountability register: every outcome with its single accountable owner, metric, cadence and status. Filter by owner (staff ref), function, store or status. unowned=true surfaces accountabilities whose owning seat is vacant or shared — the gaps a manager most needs to see.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: { ...STAFF_REF, description: 'Only what this person is accountable for' },
        function: { type: 'string', description: 'Function key: leadership | retail_ops | marketing | people | finance' },
        status: { type: 'string', enum: ['active', 'at_risk', 'paused', 'retired'] },
        store: STORE_REF,
        unowned: { type: 'boolean', description: 'Only accountabilities with no uniquely resolvable owner' },
      },
      required: [],
    },
  },
  {
    name: 'accountability_get',
    description: 'One accountability in full: owner, outcome, metric/target, cadence, contributors (contributor/consulted/informed) and recent check-ins. Pass the key, e.g. "roster-published".',
    inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] },
  },
  {
    name: 'accountability_checkin',
    description: 'PRIVILEGED WRITE: record a periodic review of an accountability (metric value, status, note) for a period. This is what a weekly/monthly meeting writes back; it also updates the register\'s headline status. Only call when explicitly asked.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Accountability key' },
        period_start: DATE,
        period_end: DATE,
        metric_value: { type: 'number' },
        status: { type: 'string', enum: ['active', 'at_risk', 'paused', 'retired'], default: 'active' },
        note: { type: 'string' },
      },
      required: ['key', 'period_start'],
    },
  },
  {
    name: 'staff_search',
    description: 'Search the staff directory. Returns compact rows with exact total — never dumps. Prefer staff_get when you already know who.',
    inputSchema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'Name, employee code, or email fragment' },
        role: { type: 'string', enum: ['staff', 'supervisor', 'store_manager', 'area_manager', 'finance', 'hq_admin'] },
        employment_type: { type: 'string', enum: ['full_time', 'part_time', 'contractor'] },
        employment_status: { type: 'string', enum: ['active', 'inactive', 'terminated'] },
        store: STORE_REF,
        limit: { type: 'number', description: 'Default 25, max 100' },
        offset: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'staff_get',
    description:
      'Get one staff member by id, employee code, or unique name. Returns titles, departments, hierarchy (manager + direct reports), and — when the connection holds reports:cost or staff:write — salary, race, citizenship, home address, NRIC and custom fields. Ambiguous names return the candidate list.',
    inputSchema: { type: 'object', properties: { staff: STAFF_REF }, required: ['staff'] },
  },
  {
    name: 'staff_create',
    description:
      'PRIVILEGED WRITE: create a staff record. display_name is required; employee_code is minted if omitted. Pass any catalog field at the top level (role, employment_type, residency, race, monthly_salary_cents, address_line_1, position_id or position code, reports_to, …), departments as function keys (retail_ops, marketing, …), and custom as { field_key: value }. Real staff are never hard-deleted later — they are terminated. Set is_dummy=true for a test person (PIN defaults to 123456). Only call when explicitly asked.',
    inputSchema: {
      type: 'object',
      properties: {
        display_name: { type: 'string' },
        employee_code: { type: 'string', description: 'Optional; auto-minted (EMP-xxxx or DUMMY-xxxx)' },
        email: { type: 'string' },
        phone: { type: 'string' },
        role: { type: 'string', enum: ['staff', 'supervisor', 'store_manager', 'area_manager', 'finance', 'hq_admin'] },
        employment_type: { type: 'string', enum: ['full_time', 'part_time', 'contractor'] },
        home_store_id: STORE_REF,
        position_id: { type: 'string', description: 'Seat uuid or position code (SM, BA, FOUNDER)' },
        reports_to_id: STAFF_REF,
        comms_title: { type: 'string' },
        hired_on: DATE,
        monthly_salary_cents: { type: 'number', description: 'Monthly basic, integer cents' },
        hourly_rate_cents: { type: 'number', description: 'Hourly rate, integer cents' },
        race: { type: 'string', enum: ['chinese', 'malay', 'indian', 'eurasian', 'other'] },
        residency: { type: 'string', enum: ['citizen', 'pr', 'foreigner'], description: 'Citizenship: Singaporean / PR / foreigner' },
        nationality: { type: 'string' },
        nric: { type: 'string' },
        date_of_birth: DATE,
        gender: { type: 'string', enum: ['female', 'male', 'non_binary', 'prefer_not_to_say', 'other'] },
        address_line_1: { type: 'string' },
        address_line_2: { type: 'string' },
        unit_number: { type: 'string' },
        postal_code: { type: 'string' },
        country: { type: 'string' },
        emergency_contact_name: { type: 'string' },
        emergency_contact_phone: { type: 'string' },
        bank_name: { type: 'string' },
        bank_account_no: { type: 'string' },
        departments: { type: 'array', items: { type: 'string' }, description: 'org_function keys; first is primary' },
        custom: { type: 'object', description: 'Workspace custom field values, { key: value }' },
        fields: { type: 'object', description: 'Alternate bag for any catalog key' },
        pin: { type: 'string', description: '4–12 digit PIN' },
        is_dummy: { type: 'boolean' },
      },
      required: ['display_name'],
    },
  },
  {
    name: 'staff_update',
    description:
      'PRIVILEGED WRITE: update a staff profile. Same field shape as staff_create (top-level catalog keys, departments[], custom{}). Omit a key to leave it; pass null to clear. Setting employment_status=terminated is the supported offboarding. departments replaces the membership list. Only call when explicitly asked.',
    inputSchema: {
      type: 'object',
      properties: {
        staff: STAFF_REF,
        display_name: { type: 'string' },
        email: { type: 'string' },
        phone: { type: 'string' },
        role: { type: 'string', enum: ['staff', 'supervisor', 'store_manager', 'area_manager', 'finance', 'hq_admin'] },
        employment_type: { type: 'string', enum: ['full_time', 'part_time', 'contractor'] },
        employment_status: { type: 'string', enum: ['active', 'inactive', 'terminated'] },
        home_store_id: STORE_REF,
        position_id: { type: 'string', description: 'Seat uuid or position code' },
        reports_to_id: STAFF_REF,
        comms_title: { type: 'string' },
        hired_on: DATE,
        terminated_on: DATE,
        monthly_salary_cents: { type: 'number' },
        hourly_rate_cents: { type: 'number' },
        race: { type: 'string', enum: ['chinese', 'malay', 'indian', 'eurasian', 'other'] },
        residency: { type: 'string', enum: ['citizen', 'pr', 'foreigner'] },
        nationality: { type: 'string' },
        nric: { type: 'string' },
        date_of_birth: DATE,
        gender: { type: 'string', enum: ['female', 'male', 'non_binary', 'prefer_not_to_say', 'other'] },
        address_line_1: { type: 'string' },
        address_line_2: { type: 'string' },
        unit_number: { type: 'string' },
        postal_code: { type: 'string' },
        country: { type: 'string' },
        emergency_contact_name: { type: 'string' },
        emergency_contact_phone: { type: 'string' },
        bank_name: { type: 'string' },
        bank_account_no: { type: 'string' },
        pt_weekly_hour_cap: { type: 'number' },
        pt_monthly_hour_cap: { type: 'number' },
        departments: { type: 'array', items: { type: 'string' }, description: 'Replace memberships; [] clears (seat function still inferred)' },
        custom: { type: 'object', description: '{ key: value }; null clears one custom field' },
        fields: { type: 'object' },
        pin: { type: 'string' },
      },
      required: ['staff'],
    },
  },
  {
    name: 'staff_delete',
    description:
      'PRIVILEGED WRITE: remove a staff member. mode=terminate (default for real staff) sets them terminated so timesheets and audit survive. mode=purge hard-deletes and is refused unless the person is a dummy (is_dummy). mode=auto purges dummies and terminates everyone else. Only call when explicitly asked.',
    inputSchema: {
      type: 'object',
      properties: {
        staff: STAFF_REF,
        mode: { type: 'string', enum: ['auto', 'terminate', 'purge'], description: 'Default auto' },
      },
      required: ['staff'],
    },
  },
  {
    name: 'staff_fields_list',
    description:
      'The staff profile field catalog: built-in HR columns (name, titles, salary, race, citizenship, address, …) plus any workspace-defined custom fields. Use this before staff_create / staff_update so you send valid keys and enum values.',
    inputSchema: {
      type: 'object',
      properties: { include_inactive: { type: 'boolean' } },
      required: [],
    },
  },
  {
    name: 'staff_field_upsert',
    description:
      'PRIVILEGED WRITE: create or update a workspace custom staff field. key is a slug (shirt_size, work_pass_expiry). type: text | number | date | boolean | enum | money_cents. sensitivity: directory (everyone with staff:read), pii or compensation (pay/identity — reports:cost or staff:write). enum needs options. Built-in keys cannot be shadowed. Only call when explicitly asked.',
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', description: 'Slug, e.g. shirt_size' },
        label: { type: 'string' },
        description: { type: 'string' },
        field_type: { type: 'string', enum: ['text', 'number', 'date', 'boolean', 'enum', 'money_cents'] },
        field_group: { type: 'string', description: 'identity | employment | org | contact | address | statutory | compensation | custom' },
        sensitivity: { type: 'string', enum: ['directory', 'pii', 'compensation'] },
        options: { type: 'array', items: { type: ['string', 'object'] }, description: 'For enum: ["S","M"] or [{value,label}]' },
        required: { type: 'boolean' },
        sort_order: { type: 'number' },
        is_active: { type: 'boolean' },
      },
      required: ['key'],
    },
  },
  {
    name: 'staff_field_delete',
    description:
      'PRIVILEGED WRITE: delete a workspace custom staff field and every stored value for it. Built-in fields cannot be deleted. Only call when explicitly asked.',
    inputSchema: {
      type: 'object',
      properties: { field: { type: 'string', description: 'Custom field key or id' } },
      required: ['field'],
    },
  },
  {
    name: 'hrm_schema_get',
    description:
      'The people schema currently IN FORCE for this workspace: staff fields, citizenship (Singaporean/PR/foreigner), titles, hierarchy, departments, people permissions and invariants. Returns JSON and verbose text. Use this instead of inventing what a staff record holds. HQ; needs hrm_schema:read.',
    inputSchema: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['both', 'json', 'text'], description: 'Default both' },
      },
      required: [],
    },
  },
  {
    name: 'hrm_schema_versions',
    description: 'List people-schema versions (git sha, hash, which one is in force). HQ; needs hrm_schema:read.',
    inputSchema: { type: 'object', properties: { limit: { type: 'number' } }, required: [] },
  },
  {
    name: 'hrm_schema_publish',
    description:
      'PRIVILEGED WRITE: put a people-schema version in force (or snapshot the current git catalogs and publish that). The swap is one database transaction — there is never two in-force policies. Only call when an HQ admin explicitly asks.',
    inputSchema: {
      type: 'object',
      properties: {
        version: { type: 'string', description: 'Version number or uuid to publish. Omit with snapshot=true to publish current.' },
        snapshot: { type: 'boolean', description: 'If true, snapshot current catalogs first, then publish that row.' },
      },
      required: [],
    },
  },
  {
    name: 'hours_worked',
    description:
      'Worked hours for ONE staff member in a timeframe — the payroll-grade computation. Returns total_hours (net of breaks), per-date and per-week breakdowns, and OT past the weekly (44h MOM default) and daily thresholds. Example: {"staff": "PT001", "from": "2026-07-27", "to": "2026-08-02"}.',
    inputSchema: {
      type: 'object',
      properties: { staff: STAFF_REF, from: DATE, to: DATE },
      required: ['staff', 'from', 'to'],
    },
  },
  {
    name: 'attendance_summary',
    description:
      'Per-staff hours, OT, days worked and flag counts for a store (or whole company) in a window. Prefer this over paginating time_entries_list for overview questions. Simulated (dummy) staff are excluded by default — pass include_dummy: true to include them.',
    inputSchema: {
      type: 'object',
      properties: {
        store: STORE_REF, from: DATE, to: DATE,
        include_dummy: { type: 'boolean', description: 'Include simulated/dummy staff in the totals (default false)' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'timesheet_status',
    description:
      'Weekly timesheet sign-off status per store: which weeks are signed off, by whom, which are still OPEN, which are OVERDUE (unsigned past week_end + 7 days), and which were amended after sign-off (edited post-close — needs re-review). Use this to answer "which timesheets are outstanding?" and "has last week been signed off?". Read-only.',
    inputSchema: {
      type: 'object',
      properties: { store: STORE_REF, from: DATE, to: DATE },
      required: ['from', 'to'],
    },
  },
  {
    name: 'time_entries_list',
    description: 'Raw time entries (one row per staff per day: clock in/out, break minutes, source). Use hours_worked for totals.',
    inputSchema: {
      type: 'object',
      properties: { staff: STAFF_REF, store: STORE_REF, from: DATE, to: DATE, limit: { type: 'number' } },
      required: [],
    },
  },
  {
    name: 'attendance_flags_list',
    description: 'Adherence/compliance flags: late, early_in, early_out, late_out, no_show, missed_clock_out, unscheduled, ot_daily, ot_weekly. Filter by staff/store/type/status.',
    inputSchema: {
      type: 'object',
      properties: {
        staff: STAFF_REF, store: STORE_REF, from: DATE, to: DATE,
        flag_type: { type: 'string' },
        status: { type: 'string', enum: ['open', 'reviewed'] },
      },
      required: [],
    },
  },
  {
    name: 'roster_get',
    description: 'The roster for a store + week (week_start = Monday). Returns the published roster by default — what staff actually work. include_draft=true also matches drafts (needs roster:write).',
    inputSchema: {
      type: 'object',
      properties: {
        store: STORE_REF,
        week_start: { ...DATE, description: 'Monday of the week, YYYY-MM-DD' },
        include_draft: { type: 'boolean', default: false },
      },
      required: ['store', 'week_start'],
    },
  },
  {
    name: 'shifts_list',
    description: 'Published shifts for a staff member and/or store in a date range. "When does Erin work next week?" → shifts_list.',
    inputSchema: {
      type: 'object',
      properties: { staff: STAFF_REF, store: STORE_REF, from: DATE, to: DATE },
      required: [],
    },
  },
  {
    name: 'availability_list',
    description: 'Availability/preference submissions (available | preferred | unavailable, with optional time windows) for a date range, including any manager locks (see availability_lock) on those dates.',
    inputSchema: {
      type: 'object',
      properties: { staff: STAFF_REF, from: DATE, to: DATE },
      required: [],
    },
  },
  {
    name: 'availability_lock',
    description: 'PRIVILEGED WRITE: lock or unlock a staff member\'s availability for specific dates, independent of the automatic edit cutoff. A locked date blocks that person\'s own self-service edits (they are told to ask their manager) but a roster:write holder can still edit through it. Typical use: freeze a week\'s availability the moment you start building its roster. Pass locked=false to unlock.',
    inputSchema: {
      type: 'object',
      properties: {
        staff: STAFF_REF,
        dates: { type: 'array', items: DATE, description: 'One or more YYYY-MM-DD dates. Locking a date with no submitted availability is allowed.' },
        locked: { type: 'boolean', default: true },
      },
      required: ['staff', 'dates'],
    },
  },
  {
    name: 'swaps_list',
    description: 'Shift swap requests with requester, counterpart and decision state.',
    inputSchema: {
      type: 'object',
      properties: { status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'] } },
      required: [],
    },
  },
  {
    name: 'leave_types_list',
    description: 'Configured leave types (AL annual, MC medical, UL unpaid, CL compassionate, …).',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'leave_balance_get',
    description: 'Leave balances (entitled/used/remaining per type) for one staff member. Defaults to the current year.',
    inputSchema: {
      type: 'object',
      properties: { staff: STAFF_REF, year: { type: 'number' } },
      required: ['staff'],
    },
  },
  {
    name: 'leave_requests_list',
    description: 'Leave requests, filterable by staff/status/date window.',
    inputSchema: {
      type: 'object',
      properties: {
        staff: STAFF_REF,
        status: { type: 'string', enum: ['pending', 'approved', 'rejected', 'cancelled'] },
        from: DATE, to: DATE,
      },
      required: [],
    },
  },
  {
    name: 'leave_request_create',
    description: 'WRITE: create a leave request for a staff member (status pending — a store manager approves it in FranHRM). Checks the balance for entitled types. Only call when explicitly asked.',
    inputSchema: {
      type: 'object',
      properties: {
        staff: STAFF_REF,
        leave_type: { type: 'string', description: 'Leave type code, e.g. AL, MC, UL' },
        start_date: DATE,
        end_date: { ...DATE, description: 'Defaults to start_date' },
        half_day: { type: 'boolean', default: false },
        reason: { type: 'string' },
      },
      required: ['staff', 'leave_type', 'start_date'],
    },
  },
  {
    name: 'roster_planning_context',
    description:
      'READ THIS BEFORE roster_generate. Returns everything you need to write good constraints for a week: the shift templates you may reference by name, who is available (with employment type and PT hour caps), submitted availability, approved/pending leave, and the current OT thresholds. Saves you inventing template names or scheduling someone who is on leave.',
    inputSchema: {
      type: 'object',
      properties: { store: STORE_REF, week_start: { ...DATE, description: 'Any date in the target week' } },
      required: ['store', 'week_start'],
    },
  },
  {
    name: 'roster_generate',
    description:
      'PROPOSE a roster for a week from constraints. THIS IS THE MAIN ROSTERING TOOL. You supply the shape of the week (who is needed when, plus rules and preferences) and it does the assignment — respecting leave, availability and PT caps as hard limits, balancing hours and rotating weekends. Writes NOTHING: it returns a proposal, a per-person hour summary, a paste-ready grid, and an honest list of slots it could NOT fill with the reason each candidate was rejected. Call roster_apply to turn a proposal into a draft.\n\nMinimum constraints: { "coverage": [{ "weekday": "daily", "blocks": [{ "template": "Opening", "count": 1 }] }] }. weekday accepts mon…sun plus daily/weekday/weekend. A block needs either a template name (see roster_planning_context) or explicit start/end times.',
    inputSchema: {
      type: 'object',
      properties: {
        store: STORE_REF,
        week_start: { ...DATE, description: 'Any date in the target week; snaps to Monday' },
        constraints: {
          type: 'object',
          description: 'Coverage, rules, preferences and staff narrowing. See the tool description for the shape.',
          properties: {
            coverage: { type: 'array', items: { type: 'object' }, description: '[{ weekday, blocks: [{ template|start+end, count, job_code?, employment_type?, only_staff? }] }]' },
            rules: { type: 'object', description: 'max_consecutive_days, min_rest_hours_between_shifts, off_days_per_week, respect_availability, respect_leave, respect_pt_caps, weekly_ot_threshold_hours, max_hours_per_day' },
            preferences: { type: 'object', description: 'fair_weekend_rotation, prefer_preferred_availability, balance_hours, keep_pairs, avoid_pairs' },
            staff: { type: 'object', description: 'include, exclude, must_work: { CODE: [days] }, max_shifts: { CODE: n }' },
          },
        },
        constraint_set_name: { type: 'string', description: 'Use a saved set instead of inline constraints' },
      },
      required: ['store', 'week_start'],
    },
  },
  {
    name: 'roster_apply',
    description: 'PRIVILEGED WRITE: turn a proposal (from roster_generate or an import) into a DRAFT roster. Staff still cannot see it — a person must publish it. Idempotent per run. Pass replace=true to overwrite an existing week\'s shifts.',
    inputSchema: {
      type: 'object',
      properties: {
        run_id: { type: 'string' },
        replace: { type: 'boolean', default: false, description: 'Overwrite the shifts already on that week' },
      },
      required: ['run_id'],
    },
  },
  {
    name: 'roster_export',
    description:
      'Export a roster in the shape the destination wants. Formats: "tsv" (paste straight into Google Sheets), "csv", "airtable" (ready-to-POST records with a field schema), "grid_tsv" (staff × day matrix, how most stores read a roster), "markdown" (show it in chat), "records" (raw JSON). Identify the roster by roster_id, or by store + week_start.',
    inputSchema: {
      type: 'object',
      properties: {
        roster_id: { type: 'string' },
        store: STORE_REF,
        week_start: DATE,
        format: { type: 'string', enum: ['records', 'csv', 'tsv', 'airtable', 'grid', 'grid_tsv', 'markdown'], default: 'markdown' },
      },
      required: [],
    },
  },
  {
    name: 'roster_history',
    description:
      'The change history for a roster — who added, moved, reassigned or removed each shift, when, from what to what, and the reason given. Use this to settle "my shift was changed" disputes and to explain an adjustment. Read-only. Identify the roster by roster_id, or by store + week_start. Newest change first.',
    inputSchema: {
      type: 'object',
      properties: {
        roster_id: { type: 'string' },
        store: STORE_REF,
        week_start: { ...DATE, description: 'Any date in the target week; snaps to Monday' },
      },
      required: [],
    },
  },
  {
    name: 'roster_import_preview',
    description:
      'Import a roster someone already keeps in a spreadsheet. Paste the sheet as CSV or tab-separated text (a copy-paste out of Google Sheets works). Auto-detects the layout — one row per shift, or a staff × day grid — guesses which column is which, resolves people/templates/dates, and DRY RUNS it: you get the mapping it chose with confidence, a sample of resolved shifts, and per-row errors. Nothing is written. Fix the mapping and call again, or call roster_import_commit with the batch_id.',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'The sheet as CSV or TSV text, including its header row' },
        store: STORE_REF,
        week_start: { ...DATE, description: 'Helps resolve dates like "17/08" that omit the year' },
        mapping: { type: 'object', description: 'Override the guess: { field: "Column Header" }, e.g. { "staff_name": "Team Member" }' },
        layout: { type: 'string', enum: ['rows', 'grid'], description: 'Override the detected layout' },
        value_aliases: { type: 'object', description: 'Translate cell values: { "AM": "Opening", "RD": null } — null means a day off' },
        mapping_name: { type: 'string', description: 'Reuse a previously saved mapping by name' },
      },
      required: ['text'],
    },
  },
  {
    name: 'roster_import_commit',
    description: 'PRIVILEGED WRITE: commit a previewed import into draft roster(s), one per week the sheet covers. Pass save_mapping_as to remember the column mapping for next time.',
    inputSchema: {
      type: 'object',
      properties: {
        batch_id: { type: 'string' },
        replace: { type: 'boolean', default: false },
        save_mapping_as: { type: 'string', description: 'e.g. "Orchard Google Sheet"' },
      },
      required: ['batch_id'],
    },
  },
  {
    name: 'shift_template_list',
    description: 'Named shift blocks ("hour blocks") a store can use as roster_generate coverage — e.g. "Opening 09:30-18:30" or an ad hoc 3-hour holiday block. A store\'s usable blocks are the shared ones (no store) plus its own. Pass include_inactive=true to also see retired ones.',
    inputSchema: {
      type: 'object',
      properties: { store: STORE_REF, include_inactive: { type: 'boolean', default: false } },
      required: [],
    },
  },
  {
    name: 'shift_template_create',
    description: 'PRIVILEGED WRITE: create a new named shift block. Names are free text — not a fixed catalog. Omit store to share it across every store; pass one to scope it there only. Shows up immediately as a column option in roster_generate coverage.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'e.g. "Opening", "Holiday 3h"' },
        start: { type: 'string', description: 'HH:MM, e.g. 09:30' },
        end: { type: 'string', description: 'HH:MM, e.g. 18:30. Must be after start — overnight blocks are not supported yet.' },
        break_minutes: { type: 'number', default: 60 },
        store: { ...STORE_REF, description: 'Omit to share across every store' },
        job_code: { type: 'string' },
      },
      required: ['name', 'start', 'end'],
    },
  },
  {
    name: 'shift_template_update',
    description: 'PRIVILEGED WRITE: update a shift block. Pass only the fields you want to change — omitted fields keep their current value.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Shift template uuid, from shift_template_list' },
        name: { type: 'string' },
        start: { type: 'string', description: 'HH:MM' },
        end: { type: 'string', description: 'HH:MM' },
        break_minutes: { type: 'number' },
        store: { ...STORE_REF, description: 'Pass "" to make it shared across stores' },
        job_code: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'shift_template_retire',
    description: 'PRIVILEGED WRITE: retire a shift block (soft delete — it drops off the roster_generate grid, but past shifts keep their label; never hard-deleted).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Shift template uuid, from shift_template_list' } },
      required: ['id'],
    },
  },
  {
    name: 'constraint_set_list',
    description: 'Saved rostering constraint sets, each with a plain-English explanation of what it asks for. Use one by name in roster_generate instead of re-describing the week.',
    inputSchema: { type: 'object', properties: { store: STORE_REF }, required: [] },
  },
  {
    name: 'constraint_set_save',
    description: 'PRIVILEGED WRITE: save a constraint set for reuse. Validates it first, so a broken set is rejected now rather than at generation time.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        store: STORE_REF,
        description: { type: 'string' },
        constraints: { type: 'object' },
      },
      required: ['name', 'constraints'],
    },
  },
  {
    name: 'payroll_compute',
    description: 'Prorate a monthly salary for a pay period, netting out approved NO-PAY leave and sabbaticals (paid leave does not cut pay). Payroll presumes a monthly rate; this is how you honour unpaid absences. Returns working days, no-pay days, and the prorated basic. Finance/HQ.',
    inputSchema: {
      type: 'object',
      properties: {
        staff: STAFF_REF,
        period_start: { ...DATE, description: 'Pay period start (usually month start)' },
        period_end: { ...DATE, description: 'Pay period end (usually month end)' },
        monthly_basic_cents: { type: 'number', description: 'Full monthly basic salary, in cents' },
      },
      required: ['staff', 'period_start', 'period_end', 'monthly_basic_cents'],
    },
  },
  {
    name: 'payroll_settings_get',
    description: 'Read the workspace CPF/EOR pay settings (Singapore). Finance/HQ only. Returns the current config plus who last changed it and when.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'payroll_settings_update',
    description: 'PRIVILEGED WRITE: update CPF/EOR pay settings. Pass a partial `settings` object to merge (or replace:true to overwrite). Every change is logged to the control plane with before/after and who made it. Finance/HQ only.',
    inputSchema: {
      type: 'object',
      properties: {
        settings: { type: 'object', description: 'Partial settings to merge, e.g. { "cpf": { "ordinary_wage_ceiling_cents": 700000 } }' },
        replace: { type: 'boolean', default: false },
        reason: { type: 'string', description: 'Why — recorded in the control-plane log' },
      },
      required: ['settings'],
    },
  },
  {
    name: 'payroll_settings_history',
    description: 'The payroll-settings change log (control plane): who changed the CPF/EOR settings, when, from where (web/API/Claude), and what keys changed. Finance/HQ only.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'shift_assign',
    description: 'PRIVILEGED WRITE: assign a staff member to a shift (or clear it with staff=null equivalent unassign=true). Used to fill open PT shifts while drafting. Warns if it would clash with approved leave.',
    inputSchema: {
      type: 'object',
      properties: {
        shift_id: { type: 'string', description: 'Shift uuid' },
        staff: { ...STAFF_REF, description: 'Staff to assign; omit with unassign=true to clear' },
        unassign: { type: 'boolean', default: false },
      },
      required: ['shift_id'],
    },
  },
  {
    name: 'roster_publish',
    description: 'PRIVILEGED WRITE: publish a draft roster, making it live for staff and T&A comparison. Returns guardrail warnings (leave clashes, PT caps, OT, missing rest days); pass force=true to publish despite warnings. Treat as production.',
    inputSchema: {
      type: 'object',
      properties: {
        roster_id: { type: 'string' },
        force: { type: 'boolean', default: false },
      },
      required: ['roster_id'],
    },
  },
]

async function getSettings(db, workspaceId) {
  const { data } = await db.from('workspaces').select('settings').eq('id', workspaceId).maybeSingle()
  return data?.settings || {}
}

/**
 * Resolve a staff reference for a rank-and-file caller: naming anyone other
 * than themselves is refused rather than silently redirected, so the agent can
 * explain the boundary instead of quietly answering the wrong question.
 */
async function resolveOwnOr(db, workspaceId, ref) {
  const actorId = getMcpActorStaffId()
  if (!actorId) {
    throw new Error('No staff identity on this connection. Pass an explicit staff reference, or connect via OAuth so FranHRM knows who you are.')
  }
  if (ref) {
    const requested = await resolveStaff(db, workspaceId, ref)
    assertCanReadStaff(requested.id, requested.display_name)
    return requested
  }
  return resolveStaff(db, workspaceId, actorId)
}

function mcpActor() {
  return {
    workspace_id: requireWorkspaceId(),
    actor_kind: 'agent',
    actor_id: getMcpActorStaffId(),
    actor_name: getMcpClientName(),
    source_type: 'mcp',
  }
}

async function withAudit(name, requestId, entity, resultBody) {
  const db = getDb()
  await recordAudit(db, {
    workspace_id: requireWorkspaceId(),
    actor_kind: 'agent',
    // OAuth callers carry the real staff member, so the audit answers "who
    // asked Claude to do this" and not merely "an agent did".
    actor_id: getMcpActorStaffId(),
    actor_name: getMcpClientName(),
    source_type: 'mcp',
    object_type: entity.object_type,
    entity_id: entity.entity_id,
    operation: entity.operation || 'INSERT',
    before_data: entity.before_data ?? null,
    after_data: entity.after_data ?? null,
    metadata: { tool_name: name, request_id: requestId, ...(entity.metadata || {}) },
  })
  return jsonResult(resultBody)
}

export async function handleTool(name, args = {}) {
  const requestId = randomUUID()
  try {
    const a = args || {}
    const db = () => getDb()
    const ws = () => requireWorkspaceId()

    switch (name) {
      case 'capabilities': {
        const scopes = getMcpScopes()
        const role = getMcpActorRole()
        return jsonResult({
          connected_as: getMcpClientName(),
          role: role ?? undefined,
          scopes: scopes ?? 'unrestricted',
          tools: resolvePermittedTools(scopes),
          note: role
            ? `Tools are scoped to your FranHRM role (${role}) and re-checked on every request — a role change takes effect immediately.`
            : 'Privileged tools need an mcp:full key (remote) or FRAN_HRM_MCP_PROFILE=full (stdio).',
        })
      }

      // Help tools need no scope: anyone connected may ask how FranHRM works.
      case 'help_search': {
        if (!a.query) throw new Error('query is required — pass the user\'s question')
        return jsonResult(await resolveHelp(db(), ws(), a.query, { limit: a.limit, role: getMcpActorRole() }))
      }

      case 'help_get': {
        return jsonResult(await getHelpArticle(db(), ws(), a.slug))
      }

      case 'help_list': {
        const articles = await listHelpArticles(db(), ws(), { category: a.category })
        return jsonResult({ articles, count: articles.length, help_index_path: '/help' })
      }

      case 'stores_list': {
        requireScope('staff:read')
        return jsonResult({ stores: await listStores(db(), ws()) })
      }

      case 'zones_list': {
        requireScope('zones:read')
        const store = await resolveStore(db(), ws(), a.store)
        return jsonResult({ store: { code: store.code, name: store.name }, zones: await listZones(db(), ws(), store.id) })
      }

      case 'org_chart': {
        requireScope('org:read')
        const [positions, staffRows] = await Promise.all([
          listPositions(db(), ws(), { include_inactive: !!a.include_inactive }),
          listStaffOrg(db(), ws(), {}),
        ])
        const tree = buildOrgTree(positions, staffRows)
        return jsonResult({
          ...tree,
          note: 'display_title is the name to use when speaking to or about someone; title is the internal/formal one.',
        })
      }

      case 'org_reporting': {
        requireScope('org:read')
        const target = actorIsRankAndFile()
          ? await resolveOwnOr(db(), ws(), a.staff)
          : await resolveStaff(db(), ws(), a.staff)
        const [positions, staffRows] = await Promise.all([
          listPositions(db(), ws(), { include_inactive: true }),
          listStaffOrg(db(), ws(), {}),
        ])
        const me = staffRows.find((s) => s.id === target.id)
        if (!me) throw new Error(`${target.display_name} is not an active staff member.`)
        const managerInfo = resolveManager(me, staffRows, positions)
        return jsonResult({
          staff: me,
          seat: positions.find((p) => p.id === me.position_id) || null,
          manager: managerInfo.manager,
          manager_source: managerInfo.source,
          direct_reports: resolveDirectReports(me, staffRows, positions),
          all_reports: resolveAllReports(me, staffRows, positions),
          reporting_chain: resolveReportingChain(me, staffRows, positions),
          accountabilities: await accountabilitiesForStaff(db(), ws(), me),
        })
      }

      case 'who_owns': {
        requireScope('org:read')
        if (!a.query) throw new Error('query is required — describe the outcome you want the owner of')
        const result = await searchAccountabilities(db(), ws(), a.query, { limit: a.limit })
        return jsonResult({
          ...result,
          hint: 'owner_name is the single accountable person. When owner_resolved is false the owning seat is vacant or shared — say so rather than naming a contributor as the owner.',
        })
      }

      case 'accountability_list': {
        requireScope('org:read')
        const owner = a.owner ? await resolveStaff(db(), ws(), a.owner) : null
        const store = a.store ? await resolveStore(db(), ws(), a.store) : null
        const rows = await listAccountabilities(db(), ws(), {
          owner_staff_id: owner?.id,
          function_key: a.function,
          status: a.status,
          store_id: store?.id,
          unowned_only: !!a.unowned,
        })
        return jsonResult({
          accountabilities: rows,
          total: rows.length,
          unowned: rows.filter((r) => !r.owner_resolved).length,
          at_risk: rows.filter((r) => r.status === 'at_risk').length,
        })
      }

      case 'accountability_get': {
        requireScope('org:read')
        return jsonResult(await getAccountability(db(), ws(), a.key))
      }

      case 'accountability_checkin': {
        requireScope('org:write')
        const { data: acc, error: accErr } = await db().from('accountabilities')
          .select('id, key, name, status').eq('workspace_id', ws()).eq('key', String(a.key || '').trim()).maybeSingle()
        if (accErr) throw new Error(accErr.message)
        if (!acc) throw new Error(`No accountability "${a.key}". Call accountability_list for the register.`)
        if (!a.period_start) throw new Error('period_start is required (YYYY-MM-DD)')

        const status = a.status || 'active'
        const { data, error } = await db().from('accountability_checkins').upsert({
          workspace_id: ws(),
          accountability_id: acc.id,
          period_start: a.period_start,
          period_end: a.period_end || null,
          metric_value: a.metric_value ?? null,
          status,
          note: a.note || null,
          recorded_by: getMcpActorStaffId(),
        }, { onConflict: 'accountability_id,period_start' }).select().single()
        if (error) throw new Error(error.message)

        if (status !== acc.status) {
          await db().from('accountabilities')
            .update({ status, updated_at: new Date().toISOString() }).eq('id', acc.id)
        }

        return withAudit(name, requestId,
          {
            object_type: 'accountability_checkins', entity_id: data.id, operation: 'INSERT',
            after_data: data, metadata: { accountability: acc.key, status_changed: status !== acc.status },
          },
          {
            checkin: data,
            accountability: acc.name,
            status,
            note: `Recorded for period starting ${a.period_start}.${status !== acc.status ? ` Register status moved to ${status}.` : ''}`,
          })
      }

      case 'staff_search': {
        requireScope('staff:read')
        const store = a.store ? await resolveStore(db(), ws(), a.store) : null
        const includeSensitive = canSeeSensitiveFields(getMcpScopes())
        return jsonResult(await listStaff(db(), ws(), {
          search: a.search, role: a.role, employment_type: a.employment_type,
          employment_status: a.employment_status, store_id: store?.id,
          limit: a.limit, offset: a.offset,
        }, { includeSensitive, includeRate: includeSensitive }))
      }

      case 'staff_get': {
        requireScope('staff:read')
        const row = await resolveStaff(db(), ws(), a.staff)
        assertCanReadStaff(row.id, row.display_name)
        const includeSensitive = canSeeSensitiveFields(getMcpScopes())
        return jsonResult({
          staff: await getStaffProfile(db(), ws(), row.id, { includeSensitive }),
          note: includeSensitive
            ? undefined
            : 'Pay, citizenship, race, address and NRIC are omitted — this connection lacks reports:cost or staff:write.',
        })
      }

      case 'staff_create': {
        // Dummy staff get their own, lighter scope — a store manager can
        // model a prospective hire without full "create real staff" rights.
        requireScope(a.is_dummy ? 'staff:dummy' : 'staff:write')
        if (!a.display_name) throw new Error('display_name is required')
        // staff:dummy alone must not be a privilege-escalation path — a
        // dummy could otherwise be role:hq_admin and impersonated for real
        // elevated scopes. Cap the assignable role at the actor's own.
        const scopes = getMcpScopes()
        if (scopes && !scopes.includes('staff:write') && a.role && !roleAtLeast(getMcpActorRole(), a.role)) {
          throw new Error(`A dummy cannot be given a role senior to your own (${getMcpActorRole()}).`)
        }
        if (a.pin) {
          if (!/^\d{4,12}$/.test(String(a.pin))) throw new Error('PIN must be 4-12 digits')
          a.pin_hash = bcrypt.hashSync(String(a.pin), 10)
        } else if (a.is_dummy) {
          a.pin_hash = bcrypt.hashSync('123456', 10)
        }
        const created = await createStaffRecord(db(), ws(), a, mcpActor())
        return jsonResult({ staff: created, note: 'Created. Real staff are terminated, never purged.' })
      }

      case 'staff_update': {
        if (!a.staff) throw new Error('staff is required')
        const target = await resolveStaff(db(), ws(), a.staff)
        requireScope(target.is_dummy ? 'staff:dummy' : 'staff:write')
        const scopes = getMcpScopes()
        if (scopes && !scopes.includes('staff:write') && a.role && !roleAtLeast(getMcpActorRole(), a.role)) {
          throw new Error(`A dummy cannot be given a role senior to your own (${getMcpActorRole()}).`)
        }
        if (a.pin) {
          if (!/^\d{4,12}$/.test(String(a.pin))) throw new Error('PIN must be 4-12 digits')
          a.pin_hash = bcrypt.hashSync(String(a.pin), 10)
        }
        const updated = await updateStaffRecord(db(), ws(), target.id, a, mcpActor())
        return jsonResult({ staff: updated })
      }

      case 'staff_delete': {
        if (!a.staff) throw new Error('staff is required')
        const target = await resolveStaff(db(), ws(), a.staff)
        requireScope(target.is_dummy ? 'staff:dummy' : 'staff:write')
        const result = await deleteStaffRecord(db(), ws(), target.id, { mode: a.mode || 'auto', actor: mcpActor() })
        return jsonResult(result)
      }

      case 'staff_fields_list': {
        requireScope('staff:read')
        const includeSensitive = canSeeSensitiveFields(getMcpScopes())
        return jsonResult({
          fields: await listCatalog(db(), ws(), { includeSensitive, includeInactive: !!a.include_inactive }),
          note: 'Built-in keys write to staff columns. Custom keys write via staff_update custom.{key}.',
        })
      }

      case 'staff_field_upsert': {
        requireScope('staff:write')
        if (!a.key) throw new Error('key is required')
        const field = await upsertCustomField(db(), ws(), a, mcpActor())
        return jsonResult({ field, note: `Use staff_update with custom.${field.key} to set a value.` })
      }

      case 'staff_field_delete': {
        requireScope('staff:write')
        if (!a.field) throw new Error('field (key or id) is required')
        return jsonResult(await deleteCustomField(db(), ws(), a.field, mcpActor()))
      }

      case 'hrm_schema_get': {
        requireScope('hrm_schema:read')
        const { row } = await ensureInForce(db(), ws(), {
          git: readGitMeta(),
          actor: { ...mcpActor(), actor_id: getMcpActorStaffId() },
        })
        const presented = presentVersion(row)
        const format = a.format || 'both'
        const out = {
          version: presented.version,
          in_force: true,
          git_sha: presented.git_sha,
          git_describe: presented.git_describe,
          content_hash: presented.content_hash,
          published_at: presented.published_at,
        }
        if (format !== 'text') out.schema = presented.schema
        if (format !== 'json') out.text = presented.text
        return jsonResult(out)
      }

      case 'hrm_schema_versions': {
        requireScope('hrm_schema:read')
        return jsonResult({ versions: (await listVersions(db(), ws(), { limit: a.limit })).map(compactVersion) })
      }

      case 'hrm_schema_publish': {
        requireScope('hrm_schema:write')
        const actor = { ...mcpActor(), actor_id: getMcpActorStaffId() }
        let targetId = null
        if (a.snapshot || !a.version) {
          const { row } = await snapshotCurrent(db(), ws(), { git: readGitMeta(), actor })
          targetId = row.id
        } else {
          const found = await getVersion(db(), ws(), a.version)
          if (!found) throw new Error(`No schema version "${a.version}". Call hrm_schema_versions.`)
          targetId = found.id
        }
        const published = await publishVersion(db(), ws(), targetId, actor)
        return jsonResult({
          in_force: presentVersion(published),
          note: `Version ${published.version} is now in force.`,
        })
      }

      case 'hours_worked': {
        requireScope('reports:read')
        // Rank-and-file staff may only ask about themselves.
        const staff = a.staff && !actorIsRankAndFile()
          ? await resolveStaff(db(), ws(), a.staff)
          : await resolveOwnOr(db(), ws(), a.staff)
        const settings = await getSettings(db(), ws())
        const result = await hoursWorked(db(), ws(), { staff_id: staff.id, from: a.from, to: a.to }, settings)
        return jsonResult({
          staff: { id: staff.id, employee_code: staff.employee_code, display_name: staff.display_name, employment_type: staff.employment_type },
          ...result,
          note: 'total_hours is net of breaks. OT is flagged for review, not auto-paid.',
        })
      }

      case 'attendance_summary': {
        requireScope('reports:read')
        // Whole-store figures are a manager view by definition.
        assertManagerView('store-wide attendance summaries')
        const store = a.store ? await resolveStore(db(), ws(), a.store) : null
        const settings = await getSettings(db(), ws())
        return jsonResult(await attendanceSummary(db(), ws(), { store_id: store?.id, from: a.from, to: a.to, includeDummy: !!a.include_dummy }, settings))
      }

      case 'timesheet_status': {
        requireScope('reports:read')
        assertManagerView('timesheet sign-off status')
        const store = a.store ? await resolveStore(db(), ws(), a.store) : null
        const result = await listTimesheetWeeks(db(), ws(), { storeId: store?.id, from: a.from, to: a.to })
        return jsonResult({
          ...result,
          note: result.overdue_count
            ? `${result.overdue_count} week(s) OVERDUE (unsigned past week_end + 7 days) — these need a supervisor to sign off.`
            : 'No overdue weeks in this window.',
        })
      }

      case 'time_entries_list': {
        requireScope('attendance:read')
        const staff = actorIsRankAndFile()
          ? await resolveOwnOr(db(), ws(), a.staff)
          : (a.staff ? await resolveStaff(db(), ws(), a.staff) : null)
        const store = a.store ? await resolveStore(db(), ws(), a.store) : null
        return jsonResult(await listTimeEntries(db(), ws(), {
          staff_id: staff?.id, store_id: staff ? undefined : store?.id, from: a.from, to: a.to, limit: a.limit,
        }))
      }

      case 'attendance_flags_list': {
        requireScope('attendance:read')
        const staff = actorIsRankAndFile()
          ? await resolveOwnOr(db(), ws(), a.staff)
          : (a.staff ? await resolveStaff(db(), ws(), a.staff) : null)
        const store = a.store ? await resolveStore(db(), ws(), a.store) : null
        return jsonResult(await listFlags(db(), ws(), {
          staff_id: staff?.id, store_id: staff ? undefined : store?.id, from: a.from, to: a.to,
          flag_type: a.flag_type, status: a.status,
        }))
      }

      case 'roster_get': {
        requireScope('roster:read')
        if (a.include_draft) requireScope('roster:write')
        const store = await resolveStore(db(), ws(), a.store)
        const roster = await getRoster(db(), ws(), {
          store_id: store.id, week_start: a.week_start, include_draft: !!a.include_draft,
        })
        if (!roster) {
          return jsonResult({
            roster: null,
            note: `No ${a.include_draft ? '' : 'published '}roster for ${store.code} week ${a.week_start}. week_start must be a Monday.`,
          })
        }
        return jsonResult({ store: { code: store.code, name: store.name }, roster })
      }

      case 'shifts_list': {
        requireScope('roster:read')
        // A staff member asking "who's on this week" gets the published store
        // roster — that is posted at the counter anyway, so it is not private.
        // But naming a specific colleague to pull their pattern is refused.
        if (actorIsRankAndFile() && a.staff) await resolveOwnOr(db(), ws(), a.staff)
        const staff = a.staff
          ? await resolveStaff(db(), ws(), a.staff)
          : (actorIsRankAndFile() ? await resolveOwnOr(db(), ws(), null) : null)
        const store = a.store ? await resolveStore(db(), ws(), a.store) : null
        const shifts = await listShifts(db(), ws(), {
          staff_id: staff?.id, store_id: store?.id, from: a.from, to: a.to, published_only: true,
        })
        return jsonResult({ shifts, total: shifts.length })
      }

      case 'availability_list': {
        requireScope('roster:read')
        const staff = actorIsRankAndFile()
          ? await resolveOwnOr(db(), ws(), a.staff)
          : (a.staff ? await resolveStaff(db(), ws(), a.staff) : null)
        const range = { staff_id: staff?.id, from: a.from, to: a.to }
        const [availability, locks] = await Promise.all([
          listAvailability(db(), ws(), range),
          listAvailabilityLocks(db(), ws(), range),
        ])
        return jsonResult({ availability, locks })
      }

      case 'availability_lock': {
        requireScope('roster:write')
        const staff = await resolveStaff(db(), ws(), a.staff)
        const dates = Array.isArray(a.dates) ? a.dates : [a.dates].filter(Boolean)
        const locked = a.locked !== false
        const locks = await setAvailabilityLocks(db(), ws(), {
          staffId: staff.id, dates, locked, lockedBy: getMcpActorStaffId(),
        }, { ...mcpActor() })
        return jsonResult({
          staff: { employee_code: staff.employee_code, display_name: staff.display_name },
          locked, dates, locks,
          note: locked
            ? `${staff.display_name}'s availability is locked for ${dates.length} date(s). They cannot edit these themselves until unlocked; a roster:write holder still can.`
            : `${staff.display_name}'s availability is unlocked for ${dates.length} date(s).`,
        })
      }

      case 'swaps_list': {
        requireScope('roster:read')
        let q = db().from('shift_swaps')
          .select('id, status, reason, created_at, decided_at, shift:shift_id(work_date, start_at, end_at), requester:requested_by(employee_code, display_name), counterpart:counterpart_staff_id(employee_code, display_name)')
          .eq('workspace_id', ws())
          .order('created_at', { ascending: false })
          .limit(100)
        if (a.status) q = q.eq('status', a.status)
        const { data, error } = await q
        if (error) throw new Error(error.message)
        return jsonResult({ swaps: data || [] })
      }

      case 'leave_types_list': {
        requireScope('leave:read')
        return jsonResult({ leave_types: await listLeaveTypes(db(), ws()) })
      }

      case 'leave_balance_get': {
        requireScope('leave:read')
        const staff = actorIsRankAndFile()
          ? await resolveOwnOr(db(), ws(), a.staff)
          : await resolveStaff(db(), ws(), a.staff)
        const balances = await getLeaveBalances(db(), ws(), { staff_id: staff.id, year: a.year })
        return jsonResult({
          staff: { employee_code: staff.employee_code, display_name: staff.display_name },
          balances,
          note: staff.employment_type === 'part_time' && !balances.length
            ? 'Part-timers have no seeded entitlements by default.' : undefined,
        })
      }

      case 'leave_requests_list': {
        requireScope('leave:read')
        const staff = actorIsRankAndFile()
          ? await resolveOwnOr(db(), ws(), a.staff)
          : (a.staff ? await resolveStaff(db(), ws(), a.staff) : null)
        return jsonResult(await listLeaveRequests(db(), ws(), {
          staff_id: staff?.id, status: a.status, from: a.from, to: a.to,
        }))
      }

      case 'leave_request_create': {
        requireScope('leave:write')
        // Staff file their own leave only — filing on someone else's behalf is
        // a manager action.
        const staff = actorIsRankAndFile()
          ? await resolveOwnOr(db(), ws(), a.staff)
          : await resolveStaff(db(), ws(), a.staff)
        const { data: types, error: ltErr } = await db().from('leave_types')
          .select('*').eq('workspace_id', ws()).eq('code', String(a.leave_type || '').toUpperCase())
        if (ltErr) throw new Error(ltErr.message)
        const leaveType = types?.[0]
        if (!leaveType) throw new Error(`Unknown leave type "${a.leave_type}". Call leave_types_list for valid codes.`)
        const startDate = a.start_date
        const endDate = a.end_date || a.start_date
        const days = leaveDaysBetween(startDate, endDate, !!a.half_day)

        if (Number(leaveType.default_days_per_year) > 0) {
          const balances = await getLeaveBalances(db(), ws(), { staff_id: staff.id, year: Number(startDate.slice(0, 4)) })
          const bal = balances.find((b) => b.leave_type === leaveType.code)
          const remaining = bal?.remaining_days ?? 0
          if (days > remaining) {
            throw new Error(`Insufficient ${leaveType.code} balance for ${staff.display_name}: requested ${days} day(s), ${remaining} remaining.`)
          }
        }

        const { data, error } = await db().from('leave_requests').insert({
          workspace_id: ws(), staff_id: staff.id, leave_type_id: leaveType.id,
          start_date: startDate, end_date: endDate, days, half_day: !!a.half_day,
          reason: a.reason || null,
        }).select().single()
        if (error) throw new Error(error.message)

        return withAudit(name, requestId,
          { object_type: 'leave_requests', entity_id: data.id, operation: 'INSERT', after_data: data },
          {
            leave_request: data, is_draft: true,
            note: `Created PENDING ${leaveType.code} request for ${staff.display_name} (${days} day(s)). A store manager must approve it in FranHRM.`,
            next_allowed_actions: ['leave_requests_list', 'leave_balance_get'],
          })
      }

      case 'roster_planning_context': {
        requireScope('roster:read')
        const store = await resolveStore(db(), ws(), a.store)
        const week = mondayOf(a.week_start)
        const pc = await loadPlanningContext(db(), ws(), { storeId: store.id, weekStart: week })
        const settings = await getSettings(db(), ws())
        const byStaff = new Map(pc.staff.map((s) => [s.id, s]))
        return jsonResult({
          store: { id: store.id, code: store.code, name: store.name },
          week_start: week,
          templates: pc.templates.map((t) => ({
            name: t.name, start: String(t.start_time).slice(0, 5), end: String(t.end_time).slice(0, 5),
            break_minutes: t.break_minutes,
          })),
          staff: pc.staff.map((s) => ({
            employee_code: s.employee_code, display_name: s.display_name,
            employment_type: s.employment_type,
            pt_weekly_hour_cap: s.pt_weekly_hour_cap ?? null,
          })),
          availability: pc.availability.map((av) => ({
            employee_code: byStaff.get(av.staff_id)?.employee_code,
            work_date: av.work_date, kind: av.kind,
            window: av.start_time ? `${String(av.start_time).slice(0, 5)}-${String(av.end_time).slice(0, 5)}` : 'all day',
          })),
          leave: pc.leave.map((l) => ({
            employee_code: byStaff.get(l.staff_id)?.employee_code,
            from: l.start_date, to: l.end_date, status: l.status,
          })),
          thresholds: {
            weekly_ot_threshold_hours: settings.ot_weekly_threshold_hours ?? 44,
            off_days_per_week: settings.off_days_per_week ?? 1,
          },
          hint: 'Reference templates by name in coverage blocks. Leave and availability are enforced as hard limits by default — you do not need to encode them yourself.',
        })
      }

      case 'roster_generate': {
        requireScope('roster:write')
        const store = await resolveStore(db(), ws(), a.store)
        let constraints = a.constraints
        let constraintSetId = null
        if (!constraints && a.constraint_set_name) {
          const { data: set } = await db().from('roster_constraint_sets')
            .select('id, constraints').eq('workspace_id', ws()).eq('name', a.constraint_set_name).maybeSingle()
          if (!set) throw new Error(`No constraint set named "${a.constraint_set_name}". Call constraint_set_list.`)
          constraints = set.constraints
          constraintSetId = set.id
        }
        if (!constraints) {
          throw new Error('Provide constraints, or constraint_set_name. Minimum: { "coverage": [{ "weekday": "daily", "blocks": [{ "template": "Opening", "count": 1 }] }] }. Call roster_planning_context for valid template names.')
        }

        const result = await generateProposal(db(), ws(), {
          storeId: store.id,
          weekStart: a.week_start,
          constraints,
          constraintSetId,
          actor: { kind: 'agent', staffId: getMcpActorStaffId(), name: getMcpClientName() },
        })

        return jsonResult({
          run_id: result.run_id,
          week_start: result.week_start,
          store: result.store,
          summary: result.summary,
          unmet: result.unmet,
          warnings: result.warnings,
          constraints_explained: result.constraints_explained,
          grid: result.table,
          note: result.summary.unfilled
            ? `Proposed ${result.summary.filled} of ${result.summary.slots} slots. ${result.summary.unfilled} could NOT be filled — show the user the unmet list with its rejection reasons before applying, since it tells them which constraint to relax.`
            : `All ${result.summary.slots} slots filled. Nothing is written yet — call roster_apply with run_id ${result.run_id} to create the draft, then a person publishes it.`,
          next_allowed_actions: ['roster_apply', 'roster_export', 'roster_generate'],
        })
      }

      case 'roster_apply': {
        requireScope('roster:write')
        const result = await applyRun(db(), ws(), a.run_id, {
          actor: { kind: 'agent', staffId: getMcpActorStaffId(), name: getMcpClientName() },
          replace: !!a.replace,
        })
        return withAudit(name, requestId,
          {
            object_type: 'rosters', entity_id: result.roster_id, operation: 'ACTION',
            after_data: { created: result.created }, metadata: { action: 'apply_roster_run', run_id: a.run_id },
          },
          { ...result, next_allowed_actions: ['roster_get', 'roster_export', 'roster_publish'] })
      }

      case 'roster_export': {
        requireScope('roster:read')
        let rosterId = a.roster_id
        if (!rosterId) {
          if (!a.store || !a.week_start) throw new Error('Provide roster_id, or store + week_start.')
          const store = await resolveStore(db(), ws(), a.store)
          const { data: r } = await db().from('rosters').select('id')
            .eq('workspace_id', ws()).eq('store_id', store.id).eq('week_start', mondayOf(a.week_start)).maybeSingle()
          if (!r) throw new Error(`No roster for ${store.code} week of ${mondayOf(a.week_start)}.`)
          rosterId = r.id
        }
        const { data: roster } = await db().from('rosters')
          .select('*, store:store_id(code, name)').eq('workspace_id', ws()).eq('id', rosterId).maybeSingle()
        if (!roster) throw new Error(`Roster ${rosterId} not found`)
        if (roster.status === 'draft') requireScope('roster:write')

        const { data: shifts } = await db().from('shifts')
          .select('*, staff:staff_id(employee_code, display_name, comms_title, position:position_id(title, comms_title))')
          .eq('roster_id', roster.id).neq('status', 'cancelled').order('work_date').order('start_at')
        const enriched = (shifts || []).map((sh) => ({
          ...sh,
          employee_code: sh.staff?.employee_code,
          display_name: sh.staff?.display_name,
          display_title: sh.staff?.comms_title || sh.staff?.position?.comms_title || sh.staff?.position?.title || null,
        }))

        const out = formatRoster(enriched, {
          format: a.format || 'markdown',
          storeName: roster.store?.name,
          weekStart: roster.week_start,
          status: roster.status,
        })
        return jsonResult({
          roster: { id: roster.id, week_start: roster.week_start, status: roster.status, store: roster.store },
          ...out,
        })
      }

      case 'roster_history': {
        requireScope('roster:history')
        let rosterId = a.roster_id
        if (!rosterId) {
          if (!a.store || !a.week_start) throw new Error('Provide roster_id, or store + week_start.')
          const store = await resolveStore(db(), ws(), a.store)
          const { data: r } = await db().from('rosters').select('id')
            .eq('workspace_id', ws()).eq('store_id', store.id).eq('week_start', mondayOf(a.week_start)).maybeSingle()
          if (!r) throw new Error(`No roster for ${store.code} week of ${mondayOf(a.week_start)}.`)
          rosterId = r.id
        }
        const { data: roster } = await db().from('rosters')
          .select('id, store_id, week_start, status, version').eq('workspace_id', ws()).eq('id', rosterId).maybeSingle()
        if (!roster) throw new Error(`Roster ${rosterId} not found`)
        const result = await rosterHistory(db(), ws(), roster)
        return jsonResult({
          ...result,
          note: result.events.length
            ? 'Newest change first. Each entry names the person, the time, what changed and any reason given.'
            : 'No changes recorded for this roster yet.',
        })
      }

      case 'roster_import_preview': {
        requireScope('roster:write')
        if (!a.text) throw new Error('text is required — paste the sheet as CSV or tab-separated text.')
        const store = a.store ? await resolveStore(db(), ws(), a.store) : null
        let mappingId = null
        if (a.mapping_name) {
          const { data: m } = await db().from('roster_import_mappings')
            .select('id').eq('workspace_id', ws()).eq('name', a.mapping_name).maybeSingle()
          if (!m) throw new Error(`No saved mapping named "${a.mapping_name}".`)
          mappingId = m.id
        }
        const result = await importPreview(db(), ws(), {
          text: a.text,
          storeId: store?.id || null,
          weekStart: a.week_start || null,
          mapping: a.mapping || null,
          layout: a.layout || null,
          valueAliases: a.value_aliases || null,
          mappingId,
          sourceName: a.mapping_name || null,
          actor: { kind: 'agent', staffId: getMcpActorStaffId(), name: getMcpClientName() },
        })
        return jsonResult({
          ...result,
          next_allowed_actions: result.ready ? ['roster_import_commit'] : ['roster_import_preview'],
        })
      }

      case 'roster_import_commit': {
        requireScope('roster:write')
        const result = await importCommit(db(), ws(), a.batch_id, {
          actor: { kind: 'agent', staffId: getMcpActorStaffId(), name: getMcpClientName() },
          replace: !!a.replace,
          saveMappingAs: a.save_mapping_as || null,
        })
        return withAudit(name, requestId,
          {
            object_type: 'roster_import_batches', entity_id: a.batch_id, operation: 'ACTION',
            after_data: { imported: result.imported }, metadata: { action: 'commit_roster_import' },
          },
          { ...result, next_allowed_actions: ['roster_get', 'roster_export', 'roster_publish'] })
      }

      case 'shift_template_list': {
        requireScope('roster:read')
        const store = a.store ? await resolveStore(db(), ws(), a.store) : null
        const templates = await listTemplates(db(), ws(), { store_id: store?.id, includeInactive: !!a.include_inactive })
        return jsonResult({ templates })
      }

      case 'shift_template_create': {
        requireScope('roster:write')
        const template = await upsertTemplate(db(), ws(), {
          name: a.name, start: a.start, end: a.end, break_minutes: a.break_minutes,
          store_id: a.store, job_code: a.job_code,
        }, mcpActor())
        return jsonResult({ template, note: 'Available immediately as a coverage option in roster_generate.' })
      }

      case 'shift_template_update': {
        requireScope('roster:write')
        if (!a.id) throw new Error('id is required')
        try {
          const template = await upsertTemplate(db(), ws(), {
            id: a.id, name: a.name, start: a.start, end: a.end,
            break_minutes: a.break_minutes, store_id: a.store, job_code: a.job_code,
          }, mcpActor())
          return jsonResult({ template })
        } catch (err) {
          throw new Error(/^No shift template/.test(err.message) ? `${err.message} Call shift_template_list for valid ids.` : err.message)
        }
      }

      case 'shift_template_retire': {
        requireScope('roster:write')
        if (!a.id) throw new Error('id is required')
        try {
          return jsonResult(await deactivateTemplate(db(), ws(), a.id, mcpActor()))
        } catch (err) {
          throw new Error(/^No shift template/.test(err.message) ? `${err.message} Call shift_template_list for valid ids.` : err.message)
        }
      }

      case 'constraint_set_list': {
        requireScope('roster:read')
        const store = a.store ? await resolveStore(db(), ws(), a.store) : null
        let q = db().from('roster_constraint_sets')
          .select('id, name, description, constraints, store_id, is_default, updated_at')
          .eq('workspace_id', ws()).order('name')
        if (store) q = q.eq('store_id', store.id)
        const { data, error } = await q
        if (error) throw new Error(error.message)
        return jsonResult({
          constraint_sets: (data || []).map((s) => ({
            name: s.name, description: s.description, is_default: s.is_default,
            explained: explainConstraints(s.constraints || {}),
          })),
          note: 'Pass a name as constraint_set_name to roster_generate.',
        })
      }

      case 'constraint_set_save': {
        requireScope('roster:write')
        const store = a.store ? await resolveStore(db(), ws(), a.store) : null
        const { data: templates } = await db().from('shift_templates')
          .select('id, name, start_time, end_time, break_minutes').eq('workspace_id', ws()).eq('is_active', true)
        const validated = validateConstraints(a.constraints, { templates: templates || [] })
        if (!validated.ok) {
          throw new Error(`Constraints are not usable:\n- ${validated.errors.join('\n- ')}`)
        }
        const { data, error } = await db().from('roster_constraint_sets').upsert({
          workspace_id: ws(),
          store_id: store?.id || null,
          name: a.name,
          description: a.description || null,
          constraints: validated.constraints,
          created_by: getMcpActorStaffId(),
          updated_at: new Date().toISOString(),
        }, { onConflict: 'workspace_id,store_id,name' }).select().single()
        if (error) throw new Error(error.message)
        return withAudit(name, requestId,
          { object_type: 'roster_constraint_sets', entity_id: data.id, operation: 'UPDATE', after_data: { name: a.name } },
          {
            constraint_set: { name: data.name, slots: validated.slot_count },
            warnings: validated.warnings,
            explained: explainConstraints(validated.constraints),
          })
      }

      case 'payroll_compute': {
        requireScope('payroll:process')
        const staff = await resolveStaff(db(), ws(), a.staff)
        return jsonResult(await computeMonthlyProration(db(), ws(), {
          staffId: staff.id, periodStart: a.period_start, periodEnd: a.period_end,
          monthlyBasicCents: Number(a.monthly_basic_cents) || 0,
        }))
      }

      case 'payroll_settings_get': {
        requireScope('payroll:settings')
        return jsonResult(await getPayrollSettings(db(), ws()))
      }

      case 'payroll_settings_update': {
        requireScope('payroll:settings')
        if (!a.settings || typeof a.settings !== 'object') throw new Error('Provide a settings object to merge.')
        const { before, after } = await updatePayrollSettings(db(), ws(), a.settings, {
          actorStaffId: getMcpActorStaffId(), replace: !!a.replace,
        })
        const keys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})])
        const changed = [...keys].filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
        return withAudit(name, requestId,
          {
            object_type: 'payroll_settings', entity_id: ws(), operation: 'UPDATE',
            before_data: before, after_data: after,
            metadata: { action: 'update_payroll_settings', changed_keys: changed, reason: a.reason || null },
          },
          { settings: after, changed, note: `Updated payroll settings (${changed.join(', ') || 'no change'}). Logged to the control plane.` })
      }

      case 'payroll_settings_history': {
        requireScope('payroll:settings')
        return jsonResult({ events: await payrollSettingsHistory(db(), ws()) })
      }

      case 'shift_assign': {
        requireScope('roster:write')
        const { data: shift, error: shErr } = await db().from('shifts')
          .select('*, roster:roster_id(status, week_start)').eq('workspace_id', ws()).eq('id', a.shift_id).maybeSingle()
        if (shErr) throw new Error(shErr.message)
        if (!shift) throw new Error(`Shift ${a.shift_id} not found`)

        let staff = null
        if (!a.unassign) {
          if (!a.staff) throw new Error('Provide staff to assign, or unassign=true to clear')
          staff = await resolveStaff(db(), ws(), a.staff)
        }

        const warnings = []
        if (staff) {
          const { data: leaves } = await db().from('leave_requests')
            .select('status, start_date, end_date, leave_type:leave_type_id(code)')
            .eq('staff_id', staff.id).in('status', ['pending', 'approved'])
            .lte('start_date', shift.work_date).gte('end_date', shift.work_date)
          for (const lv of leaves || []) {
            warnings.push(`${staff.display_name} has ${lv.status} ${lv.leave_type?.code} leave covering ${shift.work_date}`)
          }
        }

        const { data, error } = await db().from('shifts')
          .update({ staff_id: staff?.id || null, updated_at: new Date().toISOString() })
          .eq('id', shift.id).select().single()
        if (error) throw new Error(error.message)

        return withAudit(name, requestId,
          {
            object_type: 'shifts', entity_id: shift.id, operation: 'UPDATE',
            before_data: { staff_id: shift.staff_id }, after_data: { staff_id: data.staff_id },
          },
          {
            shift: data, warnings,
            roster_status: shift.roster?.status,
            note: shift.roster?.status === 'published'
              ? 'This roster is already PUBLISHED — the change is live for staff immediately.'
              : 'Draft change — staff will see it after roster_publish.',
          })
      }

      case 'roster_publish': {
        requireScope('roster:publish')
        const { data: roster, error: rErr } = await db().from('rosters')
          .select('*').eq('workspace_id', ws()).eq('id', a.roster_id).maybeSingle()
        if (rErr) throw new Error(rErr.message)
        if (!roster) throw new Error(`Roster ${a.roster_id} not found`)

        const { data: shifts } = await db().from('shifts').select('*').eq('roster_id', roster.id).neq('status', 'cancelled')
        const settings = await getSettings(db(), ws())
        const { rosterGuardrails } = await import('../../core/roster/query.mjs')
        const warnings = await rosterGuardrails(db(), ws(), roster, shifts || [], settings)
        if (warnings.length && !a.force) {
          return jsonResult({
            published: false, warnings,
            note: `${warnings.length} guardrail warning(s). Review with the user, then call again with force=true to publish anyway.`,
          })
        }

        const isRepublish = roster.status === 'published'
        const { data, error } = await db().from('rosters').update({
          status: 'published',
          version: isRepublish ? (roster.version || 1) + 1 : roster.version,
          published_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', roster.id).select().single()
        if (error) throw new Error(error.message)

        return withAudit(name, requestId,
          {
            object_type: 'rosters', entity_id: roster.id, operation: 'ACTION',
            before_data: { status: roster.status, version: roster.version },
            after_data: { status: 'published', version: data.version },
            metadata: { action: 'publish', warnings_accepted: warnings.length },
          },
          { published: true, roster: data, warnings, shift_count: (shifts || []).length })
      }

      default:
        throw new Error(`Unknown tool: ${name}. Call capabilities to list available tools.`)
    }
  } catch (err) {
    return errorResult(err)
  }
}
