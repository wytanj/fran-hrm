import { getWorkspaceSchedulingRules, loadSchedulingRulesFile, currentAvailabilityMonth, GUARDRAILS, PRICING_BASES, PAY_BASES } from '../../../../core/scheduling/rules.mjs'

// The effective scheduling rules for this workspace: file defaults overlaid
// with the workspace override (if any). Anyone who can see rosters can read
// them — the rules explain why their availability is locked.
export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const db = getAdminClient()
  const current = await getWorkspaceSchedulingRules(db, ctx.workspaceId)
  const file = loadSchedulingRulesFile()
  return {
    data: current.rules,
    version: current.version,
    source: current.source,
    updated_at: current.updated_at,
    updated_by_name: current.updated_by_name,
    defaults: { rules: file.rules, source: file.source, version: file.rules.version },
    current_window: currentAvailabilityMonth(current.rules),
    can_edit: ctx.has('roster:write'),
    options: { guardrails: GUARDRAILS, pricing_bases: PRICING_BASES, pay_bases: PAY_BASES },
  }
})
