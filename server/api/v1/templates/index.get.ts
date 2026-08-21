import { listTemplates } from '../../../../core/roster/templates.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'roster:read' })
  const q = getQuery(event)
  try {
    const data = await listTemplates(getAdminClient(), ctx.workspaceId, {
      store_id: q.store_id ? String(q.store_id) : undefined,
      includeInactive: q.include_inactive === 'true',
    })
    return { data }
  } catch (err: any) {
    const msg = err?.message || 'Could not list templates'
    throw apiError(/not a valid id/i.test(msg) ? 400 : 500, msg)
  }
})
