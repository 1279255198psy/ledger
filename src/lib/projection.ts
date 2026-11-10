import type {
  LedgerTransaction,
  RecurringRule,
} from '../types'
import { toPostings } from './allocations'
import {
  addDays,
  firstOccurrenceOnOrAfter,
  nextOccurrenceAfter,
} from './recurring'
import {
  currentMonthKey,
  daysInMonthOfKey,
  formatMoney,
  localDateKey,
} from './utils'

/**
 * End-of-month projection for the current month.
 *
 * A naive `spent / elapsed * daysInMonth` is easily distorted: rent on the 1st
 * makes the first days look expensive, and a single large purchase can double
 * the estimate. This projection instead combines:
 *
 * 1. what has already been spent;
 * 2. recurring expense rules due later this month (rent, subscriptions);
 * 3. a recent daily pace for the remaining non-recurring days.
 *
 * Months other than the current one are reported as actual spending.
 */

export interface MonthProjection {
  projectedCents: number
  actualCents: number
  /** Recurring expenses still due this month. */
  knownRecurringCents: number
  /** Daily pace used for the remaining variable days. */
  dailyPaceCents: number
  daysLeft: number
  method: 'actual' | 'recurring' | 'pace' | 'insufficient'
  /** Short human-readable explanation for the UI. */
  note: string
}

export interface MonthProjectionInput {
  transactions: LedgerTransaction[]
  monthKey: string
  /** Daily-bucket spending already recorded in the month, in cents. */
  spentCents: number
  startDate?: string | null
  recurringRules?: RecurringRule[]
  countedProjectIds?: ReadonlySet<string>
  today?: Date
}

const PACE_DAYS = 7
const MAX_RULE_WALK = 64

function dailyExpenseByDate(
  transactions: LedgerTransaction[],
  countedProjectIds?: ReadonlySet<string>,
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const posting of toPostings(transactions, countedProjectIds)) {
    if (posting.kind !== 'expense' || !posting.countsAsDaily) continue
    totals.set(
      posting.date,
      (totals.get(posting.date) ?? 0) + posting.signedCents,
    )
  }
  return totals
}

/** Daily-bucket part of a recurring rule; rules without allocations use all. */
function recurringDailyCents(rule: RecurringRule): number {
  if (rule.template.type !== 'expense') return 0
  if (rule.template.allocations.length === 0) {
    return rule.template.amountCents
  }
  return rule.template.allocations.reduce(
    (sum, line) =>
      line.targetType === 'daily' ? sum + line.amountCents : sum,
    0,
  )
}

function upcomingRecurring(
  rules: RecurringRule[],
  monthKey: string,
  todayKey: string,
  monthEnd: string,
): { cents: number; days: number } {
  let cents = 0
  const dueDays = new Set<string>()
  for (const rule of rules) {
    if (!rule.enabled || rule.stoppedAt) continue
    const amountCents = recurringDailyCents(rule)
    if (amountCents <= 0) continue
    let cursor = firstOccurrenceOnOrAfter(
      rule.frequency,
      rule.startDate,
      addDays(todayKey, 1),
    )
    for (let guard = 0; guard < MAX_RULE_WALK; guard += 1) {
      if (!cursor) break
      if (rule.endDate && cursor > rule.endDate) break
      if (cursor > monthEnd) break
      if (cursor.slice(0, 7) === monthKey) {
        cents += amountCents
        dueDays.add(cursor)
      }
      cursor = nextOccurrenceAfter(
        rule.frequency,
        rule.startDate,
        cursor,
      )
    }
  }
  return { cents, days: dueDays.size }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2
}

export function projectMonthSpend(
  input: MonthProjectionInput,
): MonthProjection {
  const today = input.today ?? new Date()
  const todayKey = localDateKey(today)
  const currentMonth = currentMonthKey(today)
  const monthEnd = `${input.monthKey}-${String(
    daysInMonthOfKey(input.monthKey),
  ).padStart(2, '0')}`
  const actual = Math.max(0, Math.round(input.spentCents))

  if (input.monthKey !== currentMonth) {
    return {
      projectedCents: actual,
      actualCents: actual,
      knownRecurringCents: 0,
      dailyPaceCents: 0,
      daysLeft: 0,
      method: 'actual',
      note: '',
    }
  }

  const totalDays = daysInMonthOfKey(input.monthKey)
  const todayDay = today.getDate()
  const startDay = input.startDate
    ? Math.max(
        1,
        input.startDate.slice(0, 7) === input.monthKey
          ? Number(input.startDate.slice(8, 10))
          : 1,
      )
    : 1
  const daysLeft = Math.max(0, totalDays - todayDay)
  if (daysLeft === 0) {
    return {
      projectedCents: actual,
      actualCents: actual,
      knownRecurringCents: 0,
      dailyPaceCents: 0,
      daysLeft: 0,
      method: 'actual',
      note: '本月已经结束',
    }
  }

  const recurring = upcomingRecurring(
    input.recurringRules ?? [],
    input.monthKey,
    todayKey,
    monthEnd,
  )

  // Recent pace over up to 7 covered days, including zero-spend days. Median
  // damps one-off purchases; the blend keeps the estimate from collapsing to
  // zero when most recent days happen to have no spending.
  const spentByDate = dailyExpenseByDate(
    input.transactions,
    input.countedProjectIds,
  )
  const window: number[] = []
  for (let offset = PACE_DAYS - 1; offset >= 0; offset -= 1) {
    const date = addDays(todayKey, -offset)
    if (date.slice(0, 7) !== input.monthKey) continue
    if (Number(date.slice(8, 10)) < startDay) continue
    window.push(spentByDate.get(date) ?? 0)
  }
  const windowTotal = window.reduce((sum, value) => sum + value, 0)
  const windowAverage = window.length > 0 ? windowTotal / window.length : 0
  const windowMedian = median(window)
  const pace =
    windowTotal > 0
      ? Math.round(
          windowMedian > 0
            ? (windowMedian + windowAverage) / 2
            : windowAverage,
        )
      : 0

  const variableDays = Math.max(0, daysLeft - recurring.days)
  const projected =
    actual + recurring.cents + Math.round(pace * variableDays)

  const method: MonthProjection['method'] =
    recurring.cents > 0
      ? 'recurring'
      : pace > 0
        ? 'pace'
        : 'insufficient'

  return {
    projectedCents: Math.max(actual, projected),
    actualCents: actual,
    knownRecurringCents: recurring.cents,
    dailyPaceCents: pace,
    daysLeft,
    method,
    note:
      recurring.cents > 0
        ? `含未来 ${recurring.days} 笔周期支出 ${formatMoney(recurring.cents / 100)}`
        : pace > 0
          ? '按近 7 天节奏估算'
          : '还没有足够的支出节奏',
  }
}
