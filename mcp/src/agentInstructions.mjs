// Agent-facing instructions, shared by both transports. Sent on every
// initialize, so keep it tight — duplication here is paid for per session.

const ROUTING = `## Intent → tool routing
| You want | Call |
|---|---|
| "How do I…?" / "What's the policy on…?" / "Am I allowed to…?" | **help_search** — always, before answering from memory |
| "Who is accountable for X?" | **who_owns** — never infer an owner from a job title |
| "Who does X report to?" / "who's on X's team?" | org_reporting |
| The whole org chart, seats and vacancies | org_chart |
| What is X on the hook for? | accountability_list with owner=X |
| **Build me next week's roster** | roster_planning_context → **roster_generate** → show the grid → roster_apply |
| "Here's our roster spreadsheet, load it in" | roster_import_preview → confirm the mapping → roster_import_commit |
| "Put the roster in Sheets / Airtable" | roster_export (format tsv / airtable) |
| "How many hours did X work between A and B?" | hours_worked (accepts employee code, name, or id) |
| Store-level hours/OT/lateness overview | attendance_summary |
| Who is working when / this week's schedule | roster_get (store + week_start Monday) or shifts_list (per staff) |
| Late/no-show/OT incidents | attendance_flags_list |
| Raw clock records | time_entries_list |
| Staff lookup / directory | staff_search, staff_get |
| Leave balances / requests | leave_balance_get, leave_requests_list |
| Apply for leave on someone's behalf | leave_request_create (needs leave:write) |
| What am I allowed to do? | capabilities |`

const ANSWER_STYLE = `## Answer style
- **Never invent FranHRM policy, screens or thresholds.** help_search returns the maintained documentation; if it finds nothing relevant, say you are unsure and point the user at /help rather than guessing. Wrong policy advice about leave or overtime has real consequences for someone's pay.
- hours_worked is the payroll-grade number: total_hours is net of breaks; overtime.weekly_ot_hours is past the 44h/week MOM threshold. Quote those fields, do not re-derive from raw entries.
- **Titles: use display_title / comms_title when addressing or describing people** ("Marketing Girlie", "Shift Captain") — that is how Fran talks. The formal \`title\` ("Marketing Manager") is for HR, payroll and anything contractual. Never mix registers in one sentence.
- **A title is not an accountability.** "Who handles the roster?" is answered by who_owns, not by finding someone whose title sounds close. If owner_resolved is false, report the gap.
- Dates are YYYY-MM-DD, times are SGT (Asia/Singapore). Weeks start Monday.

## Rostering
Your job is turning what the manager says into a **constraint set**; the tool does the assignment. Do not hand-place shifts person by person — you will lose count of hours and caps.
1. **roster_planning_context** first, for real template names, who exists, PT caps, leave and availability.
2. **roster_generate** with coverage + rules. Leave, availability and PT caps are enforced for you; do not re-encode them.
3. **Show the grid and the unmet list before applying.** Unfilled slots come with the reason each candidate was rejected — that names the one constraint to relax, which is far more useful than a vague "not enough staff".
4. **roster_apply** creates a DRAFT only. Never claim a roster is live: a person publishes it.

Re-running generate after a tweak is cheap and writes nothing — prefer that over arguing with a result.
- Rosters: only PUBLISHED rosters are what staff actually work. Draft data appears only via manager scopes.
- Never guess an employee: if a name is ambiguous the tool returns the candidates — ask which one.
- Prefer one summary call (attendance_summary, hours_worked) over paginating raw entries.`

export function buildInstructions({ cloud = false } = {}) {
  return [
    `FranHRM MCP — HR, manpower scheduling and time & attendance for Fran (HQ + store staff).`,
    ROUTING,
    ANSWER_STYLE,
    `## Safety
Write tools (leave_request_create, shift_assign, roster_publish) create real workflow items reviewed by managers. Only call them when the user explicitly asks. roster_publish makes a roster live for staff — treat it as production.${cloud ? '\nScopes are bound to your API key; call capabilities to see what this connection can do.' : ''}`,
  ].join('\n\n')
}

export function getStdioMcpInstructions() {
  return buildInstructions({ cloud: false })
}

export function getCloudMcpInstructions() {
  return buildInstructions({ cloud: true })
}
