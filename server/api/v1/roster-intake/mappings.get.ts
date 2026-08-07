// Saved column mappings, plus the field catalog the mapping UI needs.
// @ts-ignore .mjs shared module
import { ROSTER_IMPORT_FIELDS } from '../../../../core/import/fields.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const db = getAdminClient()

  const { data, error } = await db.from('roster_import_mappings')
    .select('id, name, store_id, mapping, layout, value_aliases, last_used_at, use_count, store:store_id(code, name)')
    .eq('workspace_id', ctx.workspaceId).order('last_used_at', { ascending: false, nullsFirst: false })
  if (error) throw apiError(500, error.message)

  return {
    data: data || [],
    fields: ROSTER_IMPORT_FIELDS,
    layouts: [
      { key: 'rows', label: 'One row per shift', hint: 'Columns like Date, Staff, Shift' },
      { key: 'grid', label: 'Staff × day grid', hint: 'One row per person, one column per date' },
    ],
  }
})
