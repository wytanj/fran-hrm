// Export a roster in whatever shape the destination wants.
// ?format=records|csv|tsv|airtable|grid|grid_tsv|markdown
//
// csv/tsv/grid_tsv download as files; the rest return JSON. tsv is the one to
// reach for when the destination is Google Sheets — paste it into a selection.
// @ts-ignore .mjs shared module
import { formatRoster, EXPORT_COLUMNS } from '../../../../../core/roster/export.mjs'

const DOWNLOADABLE = new Set(['csv', 'tsv', 'grid_tsv'])

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const db = getAdminClient()
  const q = getQuery(event)
  const format = String(q.format || 'records')

  const { data: roster, error } = await db
    .from('rosters').select('*, store:store_id(code, name)')
    .eq('workspace_id', ctx.workspaceId).eq('id', getRouterParam(event, 'id')).maybeSingle()
  if (error) throw apiError(500, error.message)
  if (!roster) throw apiError(404, 'Roster not found')
  if (roster.status === 'draft' && !ctx.has('roster:write')) {
    throw apiError(404, 'Roster not found')
  }

  const { data: shifts } = await db
    .from('shifts')
    .select('*, staff:staff_id(employee_code, display_name, comms_title, position:position_id(title, comms_title))')
    .eq('roster_id', roster.id).neq('status', 'cancelled')
    .order('work_date').order('start_at')

  // Flatten the title so the export layer sees display_title without knowing
  // about seats.
  const enriched = (shifts || []).map((sh: any) => ({
    ...sh,
    employee_code: sh.staff?.employee_code,
    display_name: sh.staff?.display_name,
    display_title: sh.staff?.comms_title || sh.staff?.position?.comms_title || sh.staff?.position?.title || null,
  }))

  const result = formatRoster(enriched, {
    format,
    storeName: roster.store?.name,
    weekStart: roster.week_start,
    status: roster.status,
  })

  if (DOWNLOADABLE.has(format) && q.download !== 'false') {
    const ext = format === 'csv' ? 'csv' : 'tsv'
    setHeader(event, 'Content-Type', `${result.content_type}; charset=utf-8`)
    setHeader(event, 'Content-Disposition',
      `attachment; filename="roster_${roster.store?.code || 'store'}_${roster.week_start}.${ext}"`)
    return result.data
  }

  return {
    data: {
      roster: {
        id: roster.id, week_start: roster.week_start, status: roster.status,
        version: roster.version, store: roster.store,
      },
      columns: EXPORT_COLUMNS,
      ...result,
    },
  }
})
