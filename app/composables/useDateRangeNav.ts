import type { CalendarMode } from '../utils/calendarDates'
import {
  todaySG, navWindow, clampDate, visibleRange, formatRangeLabel,
  canStep, stepAnchor,
} from '../utils/calendarDates'

/**
 * Day / week / month browsing window, clamped to ±12 months from today.
 *
 * Clamp is on the *anchor* date (the YYYY-MM-DD the view is keyed on), not
 * the derived range. A week or month that straddles the bound is still
 * reachable as long as `anchor` itself sits inside the window. prev/next
 * disable once the next step would move the anchor outside — they never
 * silently snap to a different date than the user asked for.
 */
export function useDateRangeNav(opts?: {
  initialMode?: CalendarMode
  initialAnchor?: string
}) {
  const today = todaySG()
  const { min: minDate, max: maxDate } = navWindow(today)

  const mode = ref<CalendarMode>(opts?.initialMode ?? 'week')
  const anchor = ref(clampDate(opts?.initialAnchor ?? today, minDate, maxDate))

  const rangeStart = computed(() => visibleRange(mode.value, anchor.value).start)
  const rangeEnd = computed(() => visibleRange(mode.value, anchor.value).end)
  const label = computed(() => formatRangeLabel(mode.value, rangeStart.value, rangeEnd.value))

  const canGoPrev = computed(() => canStep(mode.value, anchor.value, -1, minDate, maxDate))
  const canGoNext = computed(() => canStep(mode.value, anchor.value, 1, minDate, maxDate))

  const containsToday = computed(() => {
    const t = todaySG()
    return rangeStart.value <= t && t <= rangeEnd.value
  })

  function setAnchor(date: string) {
    if (date < minDate || date > maxDate) return
    anchor.value = date
  }

  function next() {
    if (!canGoNext.value) return
    anchor.value = stepAnchor(mode.value, anchor.value, 1)
  }

  function prev() {
    if (!canGoPrev.value) return
    anchor.value = stepAnchor(mode.value, anchor.value, -1)
  }

  function goToday() {
    anchor.value = todaySG()
  }

  return {
    mode,
    anchor,
    rangeStart,
    rangeEnd,
    label,
    next,
    prev,
    goToday,
    setAnchor,
    canGoPrev,
    canGoNext,
    containsToday,
    minDate,
    maxDate,
    today,
  }
}

export type DateRangeNav = ReturnType<typeof useDateRangeNav>
