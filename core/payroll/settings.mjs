// Payroll (CPF/EOR) settings — read/update shared by REST + MCP. The write path
// returns before/after so the caller can audit it; that audit trail IS the
// control plane. Only payroll:settings holders (finance/hq_admin) reach here.

// A starting Singapore shape — finance fills in the real figures. CPF rates are
// age-banded; capture the bands your EOR uses under cpf.bands rather than
// baking assumptions here.
export const DEFAULT_PAYROLL_SETTINGS = {
  country: 'SG',
  currency: 'SGD',
  pay_cycle: 'monthly',
  cpf: {
    enabled: true,
    ordinary_wage_ceiling_cents: 700000, // S$7,000
    additional_wage_ceiling_cents: 10200000, // S$102,000
    bands: [], // [{ label, age_min, age_max, employer_pct, employee_pct }]
  },
  eor: { provider: null, reference: null },
}

function isObject(v) {
  return v && typeof v === 'object' && !Array.isArray(v)
}
/** Deep-merge a patch onto base (arrays and scalars replace; objects merge). */
export function mergeSettings(base, patch) {
  const out = { ...base }
  for (const [k, v] of Object.entries(patch || {})) {
    out[k] = isObject(v) && isObject(out[k]) ? mergeSettings(out[k], v) : v
  }
  return out
}

export async function getPayrollSettings(db, workspaceId) {
  const { data } = await db.from('payroll_settings').select('*').eq('workspace_id', workspaceId).maybeSingle()
  return {
    settings: mergeSettings(DEFAULT_PAYROLL_SETTINGS, data?.settings || {}),
    configured: !!data,
    updated_at: data?.updated_at || null,
    updated_by: data?.updated_by || null,
  }
}

/**
 * Apply a settings patch. Returns { before, after } so the caller writes the
 * audit event (control plane). Full replace when opts.replace is true.
 */
export async function updatePayrollSettings(db, workspaceId, patch, { actorStaffId = null, replace = false } = {}) {
  const current = await getPayrollSettings(db, workspaceId)
  const next = replace
    ? mergeSettings(DEFAULT_PAYROLL_SETTINGS, patch || {})
    : mergeSettings(current.settings, patch || {})
  const { data, error } = await db.from('payroll_settings').upsert({
    workspace_id: workspaceId,
    settings: next,
    updated_by: actorStaffId,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'workspace_id' }).select().single()
  if (error) throw new Error(error.message)
  return { before: current.settings, after: next, row: data }
}

/** The control-plane change log: payroll settings edits, newest first. */
export async function payrollSettingsHistory(db, workspaceId, { limit = 100 } = {}) {
  const { data, error } = await db.from('audit_events')
    .select('id, actor_kind, actor_name, source_type, operation, before_data, after_data, metadata, created_at')
    .eq('workspace_id', workspaceId).eq('object_type', 'payroll_settings')
    .order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return (data || []).map((e) => ({
    at: e.created_at,
    actor_name: e.actor_name || (e.actor_kind === 'agent' ? 'Claude (agent)' : 'System'),
    actor_kind: e.actor_kind,
    source: e.source_type,
    changed: e.metadata?.changed_keys || [],
    reason: e.metadata?.reason || null,
  }))
}
