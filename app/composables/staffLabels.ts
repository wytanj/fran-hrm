// Shared employment-type labels so FT / PT / Contractor read the same on every
// screen (Team, Roster, Reports).
export function empTypeShort(t?: string) {
  return ({ full_time: 'FT', part_time: 'PT', contractor: 'CTR' } as Record<string, string>)[t || ''] || 'FT'
}
export function empTypeName(t?: string) {
  return ({ full_time: 'Full-time', part_time: 'Part-time', contractor: 'Contractor' } as Record<string, string>)[t || ''] || (t || '—')
}
export function empTypeTone(t?: string) {
  return ({ part_time: 'accent', contractor: 'warning' } as Record<string, string>)[t || ''] || 'muted'
}
