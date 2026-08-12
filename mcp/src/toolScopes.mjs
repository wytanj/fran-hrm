// Central tool → scope catalog. tools/list and tools/call filter on this
// AND each handler calls requireScope() itself — double gate, so a tool can
// never run on scope the connection doesn't hold.

export const TOOL_SCOPE_CATALOG = {
  capabilities: { scope: null, action: 'List the tools this connection may call' },

  // Help centre: scope null so a lost user can always ask how something works,
  // whatever their role. Articles are policy documentation, not staff data.
  help_search: { scope: null, action: 'Find the current FranHRM policy/how-to for a question' },
  help_get: { scope: null, action: 'Read a full help article by slug' },
  help_list: { scope: null, action: 'List all help articles' },

  stores_list: { scope: 'staff:read', action: 'List Fran stores/locations' },
  zones_list: { scope: 'zones:read', action: 'The mapped zones of a store floor (name, colour, position) — for scheduling & analytics' },
  staff_search: { scope: 'staff:read', action: 'Search the staff directory (name, code, role, store, FT/PT)' },
  staff_get: { scope: 'staff:read', action: 'One staff member by id, employee code, or unique name' },

  // Org + accountability
  org_chart: { scope: 'org:read', action: 'The org chart: seats, titles, holders and vacancies' },
  org_reporting: { scope: 'org:read', action: "One person's seat, manager, direct reports and reporting chain" },
  who_owns: { scope: 'org:read', action: 'Find who is accountable for an outcome, in plain language' },
  accountability_list: { scope: 'org:read', action: 'The accountability register, filterable by owner/function/status' },
  accountability_get: { scope: 'org:read', action: 'One accountability with contributors and recent check-ins' },
  accountability_checkin: { scope: 'org:write', action: 'Record a periodic accountability review', privileged: true },

  hours_worked: { scope: 'reports:read', action: 'Worked hours for one staff member in a timeframe, with OT breakdown' },
  attendance_summary: { scope: 'reports:read', action: 'Per-staff hours/OT/lateness summary for a store + window' },
  timesheet_status: { scope: 'reports:read', action: 'Weekly timesheet sign-off status per store, with overdue and amended-after-close flags' },
  time_entries_list: { scope: 'attendance:read', action: 'Raw time entries (clock in/out/breaks) for staff or store' },
  attendance_flags_list: { scope: 'attendance:read', action: 'Adherence flags: late, no-show, OT, unscheduled…' },

  roster_get: { scope: 'roster:read', action: 'Published roster (shifts by day) for a store + week' },
  roster_history: { scope: 'roster:history', action: 'The change log for a roster: who adjusted which shift, when and why — for disputes' },
  shifts_list: { scope: 'roster:read', action: 'Shifts for a staff member or store in a date range' },
  availability_list: { scope: 'roster:read', action: 'Staff availability submissions for a date range' },
  swaps_list: { scope: 'roster:read', action: 'Shift swap requests and their status' },

  leave_types_list: { scope: 'leave:read', action: 'Configured leave types' },
  leave_balance_get: { scope: 'leave:read', action: 'Leave balances for one staff member' },
  leave_requests_list: { scope: 'leave:read', action: 'Leave requests by status/staff/window' },
  leave_request_create: { scope: 'leave:write', action: 'Create a leave request (goes to SM for approval)' },

  shift_assign: { scope: 'roster:write', action: 'Assign/unassign a staff member on a shift (drafting)', privileged: true },
  roster_publish: { scope: 'roster:publish', action: 'Publish a draft roster (makes it live for staff + T&A)', privileged: true },

  // Roster intake: generate from constraints, import a sheet, export anywhere.
  roster_planning_context: { scope: 'roster:read', action: 'Who is available, templates, leave and caps for a week — read this before generating' },
  roster_generate: { scope: 'roster:write', action: 'Propose a roster from constraints (writes nothing until applied)', privileged: true },
  roster_apply: { scope: 'roster:write', action: 'Turn a proposal into a DRAFT roster', privileged: true },
  roster_export: { scope: 'roster:read', action: 'Export a roster for Sheets, Airtable, CSV or markdown' },
  roster_import_preview: { scope: 'roster:write', action: 'Parse a pasted roster sheet, map its columns, dry-run', privileged: true },
  roster_import_commit: { scope: 'roster:write', action: 'Commit a previewed import into draft roster(s)', privileged: true },
  constraint_set_list: { scope: 'roster:read', action: 'Saved reusable rostering constraint sets' },
  constraint_set_save: { scope: 'roster:write', action: 'Save a reusable constraint set', privileged: true },

  // Payroll control plane — CPF/EOR pay settings. Finance/HQ only; writes logged.
  payroll_compute: { scope: 'payroll:process', action: 'Prorate a monthly salary for approved no-pay leave / sabbatical in a period' },
  payroll_settings_get: { scope: 'payroll:settings', action: 'Read CPF/EOR pay settings' },
  payroll_settings_update: { scope: 'payroll:settings', action: 'Update CPF/EOR pay settings (logged to the control plane)', privileged: true },
  payroll_settings_history: { scope: 'payroll:settings', action: 'The payroll-settings change log (control plane)' },
}

export function isToolPermitted(toolName, opts = {}) {
  const meta = TOOL_SCOPE_CATALOG[toolName]
  if (!meta) return opts.scopes == null // unknown tool: unrestricted only
  if (meta.scope == null) return true
  if (opts.scopes == null) return true
  return opts.scopes.includes(meta.scope)
}

export function resolvePermittedTools(scopes) {
  return Object.entries(TOOL_SCOPE_CATALOG)
    .filter(([name]) => isToolPermitted(name, { scopes }))
    .map(([name, meta]) => ({ name, scope: meta.scope, action: meta.action, privileged: !!meta.privileged }))
}
