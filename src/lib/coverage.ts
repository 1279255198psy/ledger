import type { LedgerTransaction, MonthCoverageStatus } from '../types'

/**
 * Ledger coverage.
 *
 * Statistics are only honest when we know which days the books actually
 * cover. The first month often starts mid-month and the current month is still
 * running, so `monthCoverage` labels every month as one of:
 *
 * - `complete`     — a past month covered from day 1;
 * - `first-partial`— the month the ledger started, after day 1;
 * - `current`      — this month, measured to date;
 * - `future`       — later than this month;
 * - `before-start` — earlier than the ledger start.
 *
 * Averages, stability metrics and health scores should only consume
 * `complete` months; totals stay as recorded and are merely labelled.
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/

export interface MonthCoverage {
  monthKey: string
  status: MonthCoverageStatus
  totalDays: number
  /** Days in the month that the ledger covers. */
  effectiveDays: number
  /** First covered day (1-based), or 0 when the month is not covered. */
  startDay: number
  /** Last covered day (1-based): today for the current month, else month end. */
  endDay: number
  /** True only for a past month covered from day 1. */
  complete: boolean
  /** True when the month is in progress or the ledger started mid-month. */
  partial: boolean
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function daysInMonth(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

function todayKeyOf(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function isCoverageDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  )
}

export function isCoverageMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_PATTERN.test(value)
}

/** The earliest date present in the books, ignoring future-dated entries. */
export function earliestTransactionDate(
  transactions: LedgerTransaction[],
): string | null {
  let earliest: string | null = null
  for (const transaction of transactions) {
    if (earliest === null || transaction.date < earliest) {
      earliest = transaction.date
    }
  }
  return earliest && isCoverageDateKey(earliest) ? earliest : null
}

/**
 * A manual override wins; otherwise the ledger start follows the earliest
 * transaction, so importing older history moves the baseline back on its own.
 */
export function resolveLedgerStartDate(
  transactions: LedgerTransaction[],
  override?: string | null,
): string | null {
  if (override && isCoverageDateKey(override)) return override
  return earliestTransactionDate(transactions)
}

export function monthCoverage(
  monthKey: string,
  startDate: string | null | undefined,
  now = new Date(),
): MonthCoverage {
  const totalDays = daysInMonth(monthKey)
  const todayKey = todayKeyOf(now)
  const currentMonth = todayKey.slice(0, 7)

  const empty = (status: MonthCoverageStatus): MonthCoverage => ({
    monthKey,
    status,
    totalDays,
    effectiveDays: 0,
    startDay: 0,
    endDay: 0,
    complete: false,
    partial: status === 'current' || status === 'first-partial',
  })

  if (monthKey > currentMonth) return empty('future')

  const validStart =
    startDate && isCoverageDateKey(startDate) ? startDate : null
  const startMonth = validStart ? validStart.slice(0, 7) : null
  if (startMonth && monthKey < startMonth) return empty('before-start')

  const startDay =
    validStart && startMonth === monthKey
      ? Number(validStart.slice(8, 10))
      : 1
  const endDay =
    monthKey === currentMonth ? Number(todayKey.slice(8, 10)) : totalDays
  const effectiveDays = Math.max(0, endDay - startDay + 1)

  const status: MonthCoverageStatus =
    monthKey === currentMonth
      ? 'current'
      : startDay > 1
        ? 'first-partial'
        : 'complete'

  return {
    monthKey,
    status,
    totalDays,
    effectiveDays,
    startDay,
    endDay,
    complete: status === 'complete',
    partial: status === 'current' || status === 'first-partial',
  }
}

/** Covered days in a month; 0 for months before the ledger start or later. */
export function effectiveDaysInMonth(
  monthKey: string,
  startDate: string | null | undefined,
  now = new Date(),
): number {
  return monthCoverage(monthKey, startDate, now).effectiveDays
}

export function formatCoverageDay(day: number): string {
  return `${day} 日`
}

/** Short label for chart tooltips and coverage notes. */
export function monthCoverageLabel(coverage: MonthCoverage): string {
  switch (coverage.status) {
    case 'complete':
      return `${coverage.totalDays} 天完整月`
    case 'first-partial':
      return `首月自 ${coverage.startDay} 日起 · ${coverage.effectiveDays}/${coverage.totalDays} 天`
    case 'current':
      return coverage.startDay > 1
        ? `本月自 ${coverage.startDay} 日起 · ${coverage.effectiveDays}/${coverage.totalDays} 天`
        : `本月至今 · ${coverage.effectiveDays}/${coverage.totalDays} 天`
    case 'future':
      return '尚未开始'
    case 'before-start':
      return '早于统计起点'
  }
}

/** How many months from the ledger start through `endMonth` are complete. */
export function completeMonthsUpTo(
  startDate: string | null | undefined,
  endMonth: string,
  now = new Date(),
): number {
  const anchor = endMonth
  const validStart =
    startDate && isCoverageDateKey(startDate) ? startDate : null
  const firstMonth = validStart
    ? validStart.slice(0, 7)
    : anchor
  let count = 0
  let cursor = firstMonth
  // Walk month by month; the loop is bounded by real calendar data.
  for (let guard = 0; guard < 240; guard += 1) {
    if (cursor > anchor) break
    if (monthCoverage(cursor, startDate, now).complete) count += 1
    const [year, month] = cursor.split('-').map(Number)
    const date = new Date(year, month, 1)
    cursor = `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
  }
  return count
}

/** The month immediately before `monthKey`, without importing utils. */
export function previousMonthOf(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 2, 1)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}
