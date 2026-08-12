// Download the CPF EZPay upload CSV for a month, generated from the month's
// payslips + staff CPF fields. payroll:process (finance/HQ).
// @ts-ignore .mjs shared module
import { generateCpfEzpay } from '../../../../core/payroll/cpfEzpay.mjs'

export default defineEventHandler(async (event) => {
  const ctx = await requireActor(event, { scope: 'payroll:process' })
  const q = getQuery(event)
  const month = String(q.month || '')
  const db = getAdminClient()

  const { csv } = await generateCpfEzpay(db, ctx.workspaceId, { month })
    .catch((err: any) => { throw apiError(422, err.message) })

  setHeader(event, 'Content-Type', 'text/csv; charset=utf-8')
  setHeader(event, 'Content-Disposition', `attachment; filename="cpf_ezpay_${month}.csv"`)
  return csv
})
