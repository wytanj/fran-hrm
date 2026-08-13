import { listStaff } from '../../../../core/staff/query.mjs'
import { canSeeSensitiveFields } from '../../../../core/staff/profile.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'staff:read' })
  const q = getQuery(event)
  // Pay + statutory identity: reports:cost (finance) or staff:write (admins).
  const includeSensitive = canSeeSensitiveFields((s: string) => ctx.has(s))
  return listStaff(getAdminClient(), ctx.workspaceId, {
    limit: q.limit,
    offset: q.offset,
    role: q.role,
    employment_type: q.employment_type,
    employment_status: q.employment_status,
    store_id: q.store_id,
    search: q.search,
  }, { includeSensitive, includeRate: includeSensitive })
})

