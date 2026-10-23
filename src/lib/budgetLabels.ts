import { formatShortDate } from './utils'
import type { RangeBudget } from '../types'

/** "2026年10月1日 – 10月7日" (years repeat only when they differ). */
export function formatRangeLabel(startDate: string, endDate: string): string {
  const start = `${startDate.slice(0, 4)}年${formatShortDate(startDate)}`
  if (startDate.slice(0, 4) === endDate.slice(0, 4)) {
    return `${start} – ${formatShortDate(endDate)}`
  }
  return `${start} – ${endDate.slice(0, 4)}年${formatShortDate(endDate)}`
}

export function rangeTitle(range: RangeBudget): string {
  const name = range.name?.trim()
  return name ? name : formatRangeLabel(range.startDate, range.endDate)
}
