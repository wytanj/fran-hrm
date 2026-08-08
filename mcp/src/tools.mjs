// FranHRM MCP tools: definitions (hand-written JSON Schema, advisory to the
// model) + handleTool() dispatch. Handlers delegate to core/* query modules —
// the same code the REST API runs, so agents and the web app always agree.
import { randomUUID } from 'node:crypto'
import {
  actorIsRankAndFile, assertCanReadStaff, assertManagerView,
  errorResult, getDb, getMcpActorRole, getMcpActorStaffId, getMcpClientName,
  getMcpScopes, jsonResult, requireScope, requireWorkspaceId,
} from './context.mjs'
import { TOOL_SCOPE_CATALOG, resolvePermittedTools } from './toolScopes.mjs'
import { listStaff, resolveStaff, resolveStore, listStores, compactStaff } from '../../core/staff/query.mjs'
import { getRoster, listShifts, listAvailability } from '../../core/roster/query.mjs'
import { validateConstraints, explainConstraints } from '../../core/roster/constraints.mjs'
import { formatRoster } from '../../core/roster/export.mjs'
import {
  applyRun, generateProposal, importCommit, importPreview, loadPlanningContext, mondayOf,
} from '../../core/roster/intake.mjs'
import { hoursWorked, attendanceSummary, listTimeEntries, listFlags } from '../../core/attendance/query.mjs'
import { listLeaveTypes, listLeaveRequests, getLeaveBalances, leaveDaysBetween } from '../../core/leave/query.mjs'
import { resolveHelp, getHelpArticle, listHelpArticles } from '../../core/help/resolve.mjs'
import {
  accountabilitiesForStaff, buildOrgTree, getAccountability, listAccountabilities,
  listPositions, listStaffOrg, resolveAllReports, resolveDirectReports,
  resolveManager, resolveReportingChain, searchAccountabilities,
} from '../../core/org/query.mjs'
import { recordAudit } from '../../core/audit/record.mjs'
import { rosterHistory } from '../../core/audit/history.mjs'

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
    description: 'Read a full help article by slug (use after help_search when you need the whole article). Slugs: clock-in-out, time-corrections, leave-requests, availability-and-swaps, overtime-and-hours, roster-publish, offline-fallback, connect-claude, signing-in, payroll-lock.',
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
        role: { type: 'string', enum: ['staff', 'supervisor', 'store_manager', 'area_manager', 'hq_admin'] },
        employment_type: { type: 'string', enum: ['full_time', 'part_time'] },
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
    description: 'Get one staff member by id, employee code, or unique name. Ambiguous names return the candidate list.',
    inputSchema: { type: 'object', properties: { staff: STAFF_REF }, required: ['staff'] },
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
      'Per-staff hours, OT, days worked and flag counts for a store (or whole company) in a window. Prefer this over paginating time_entries_list for overview questions.',
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
    description: 'Availability/preference submissions (available | preferred | unavailable, with optional time windows) for a date range.',
    inputSchema: {
      type: 'object',
      properties: { staff: STAFF_REF, from: DATE, to: DATE },
      required: [],
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
        return jsonResult(await listStaff(db(), ws(), {
          search: a.search, role: a.role, employment_type: a.employment_type,
          employment_status: a.employment_status, store_id: store?.id,
          limit: a.limit, offset: a.offset,
        }))
      }

      case 'staff_get': {
        requireScope('staff:read')
        const row = await resolveStaff(db(), ws(), a.staff)
        return jsonResult({ staff: compactStaff(row) })
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
        return jsonResult(await attendanceSummary(db(), ws(), { store_id: store?.id, from: a.from, to: a.to }, settings))
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
        return jsonResult({ availability: await listAvailability(db(), ws(), { staff_id: staff?.id, from: a.from, to: a.to }) })
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
