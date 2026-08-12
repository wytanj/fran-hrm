// Cents → display money. Payroll is integer cents everywhere.
export function money(cents?: number, currency = 'SGD') {
  const v = (Number(cents) || 0) / 100
  const prefix = currency === 'SGD' ? 'S$' : `${currency} `
  return `${prefix}${v.toLocaleString('en-SG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
