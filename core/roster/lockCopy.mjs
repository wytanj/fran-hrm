// Plain-language copy for availability lock/unlock — used by the in-app
// notification (one per setAvailabilityLocks call) and the lock-history
// timeline so both surfaces describe the same action the same way.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function formatDayShort(date, { withYear = false } = {}) {
  const m = String(date || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return String(date || '')
  const day = Number(m[3])
  const month = MONTHS[Number(m[2]) - 1] || m[2]
  return withYear ? `${day} ${month} ${m[1]}` : `${day} ${month}`
}

/** True when sorted unique dates are a contiguous run of calendar days. */
export function isContiguous(dates) {
  const unique = [...new Set(dates || [])].sort()
  if (unique.length <= 1) return true
  return unique.every((d, i) => i === 0 || addDays(unique[i - 1], 1) === d)
}

/**
 * Human span for a set of YYYY-MM-DD dates.
 *   ['2026-08-24']                         → '24 Aug'
 *   ['2026-08-24'..'2026-08-30'] (contig.) → '24–30 Aug'
 *   a few gaps                             → '24 Aug, 26 Aug and 28 Aug'
 *   many gaps                              → '4 dates (24 Aug–30 Aug)'
 */
export function formatDateSpan(dates) {
  const unique = [...new Set((dates || []).filter(Boolean))].sort()
  if (!unique.length) return 'those dates'
  const yearNeeded = unique[0].slice(0, 4) !== unique[unique.length - 1].slice(0, 4)
  const label = (d) => formatDayShort(d, { withYear: yearNeeded })
  if (unique.length === 1) return label(unique[0])
  const first = label(unique[0])
  const last = label(unique[unique.length - 1])
  if (isContiguous(unique)) {
    const sameMonth = unique[0].slice(0, 7) === unique[unique.length - 1].slice(0, 7)
    if (sameMonth && !yearNeeded) {
      const month = MONTHS[Number(unique[0].slice(5, 7)) - 1]
      return `${Number(unique[0].slice(8))}–${Number(unique[unique.length - 1].slice(8))} ${month}`
    }
    return `${first}–${last}`
  }
  if (unique.length <= 3) {
    const names = unique.map(label)
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
  }
  return `${unique.length} dates (${first}–${last})`
}

export function datesOverlapRange(dates, from, to) {
  if (!from || !to) return true
  return (dates || []).some((d) => d >= from && d <= to)
}

/**
 * Payload for createNotification after a lock/unlock.
 * One notification per call, even when many dates were frozen at once.
 */
export function availabilityLockNotification({ locked, dates, actorName }) {
  const span = formatDateSpan(dates)
  const verb = locked ? 'locked' : 'unlocked'
  const by = actorName ? ` by ${actorName}` : ''
  return {
    type: locked ? 'availability_locked' : 'availability_unlocked',
    title: locked ? 'Availability locked' : 'Availability unlocked',
    body: `Your availability for ${span} was ${verb}${by}.`,
    link: '/availability',
    metadata: {
      dates: [...new Set(dates || [])].sort(),
      operation: locked ? 'LOCK' : 'UNLOCK',
      actor_name: actorName || null,
    },
  }
}

/** History-timeline sentence: "Chloe Tan locked Erin Goh's availability for 24–30 Aug" */
export function summariseLockEvent({ operation, staffName, dates, actorName }) {
  const span = formatDateSpan(dates)
  const verb = operation === 'UNLOCK' ? 'unlocked' : 'locked'
  const who = staffName || 'a staff member'
  const actor = actorName || 'Someone'
  return `${actor} ${verb} ${who}'s availability for ${span}`
}
