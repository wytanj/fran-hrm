// Download Aspire payout CSV for a month from the earnings engine.
// payroll:process (finance/HQ). First-class Payroll UI path — not MCP.
// @ts-ignore .mjs shared module
import { generateAspirePayout } from '../../../../core/payroll/aspire.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'payroll:process' })
  const q = getQuery(event)
  const month = String(q.month || '')
  const db = getAdminClient()

  const { csv } = await generateAspirePayout(db, ctx.workspaceId, { month })
    .catch((err: any) => { throw apiError(422, err.message) })

  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="aspire_payout_${month}.csv"`)
  return csv
})
