// @ts-ignore .mjs shared module
import { explainConstraints } from '../../../../core/roster/constraints.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const db = getAdminClient()
  const q = getQuery(event)

  let query = db.from('roster_constraint_sets')
    .select('id, store_id, name, description, constraints, is_default, updated_at, store:store_id(code, name)')
    .eq('workspace_id', ctx.workspaceId).order('name')
  if (q.store_id) query = query.eq('store_id', String(q.store_id))
  const { data, error } = await query
  if (error) throw apiError(500, error.message)

  return {
    data: (data || []).map((s: any) => ({
      ...s,
      explained: explainConstraints(s.constraints || {}),
    })),
    total: (data || []).length,
  }
})
