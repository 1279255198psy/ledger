import { formatShortDate } from './utils'
import type { BudgetAdjustment, RangeBudget } from '../types'

/** "10-30 14:05" — compact enough for a log row on a phone. */
export function formatAdjustmentTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`
}

export function summarizeAdjustments(adjustments: BudgetAdjustment[]): {
  up: number
  down: number
  netCents: number
} {
  let up = 0
  let down = 0
  let netCents = 0
  for (const entry of adjustments) {
    if (entry.deltaCents > 0) up += 1
    else if (entry.deltaCents < 0) down += 1
    netCents += entry.deltaCents
  }
  return { up, down, netCents }
}

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
