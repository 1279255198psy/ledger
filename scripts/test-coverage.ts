/**
 * Standalone checks for month coverage and first-month budget proration.
 * Run with:
 *   npm run test:coverage
 */
import assert from 'node:assert/strict'
import {
  completeMonthsUpTo,
  monthCoverage,
  resolveLedgerStartDate,
} from '../src/lib/coverage'
import { getMonthBudgetMetrics } from '../src/lib/budget'
import { daysInMonthOfKey, shiftMonth } from '../src/lib/utils'
import type { BudgetBook, LedgerTransaction } from '../src/types'

const NOW = new Date(2026, 10, 10) // 2026-11-10, local time

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function firstPartialMonth(): ReturnType<typeof monthCoverage> {
  return monthCoverage('2026-09', '2026-09-15', NOW)
}

function testFirstMonthStartsOnTheEntryDay() {
  const coverage = firstPartialMonth()
  assert.equal(coverage.status, 'first-partial')
  assert.equal(coverage.startDay, 15)
  assert.equal(coverage.endDay, 30)
  assert.equal(coverage.effectiveDays, 16)
  assert.equal(coverage.totalDays, 30)
  assert.equal(coverage.complete, false)
}

function testPastMonthCoveredFromDayOneIsComplete() {
  const coverage = monthCoverage('2026-10', '2026-09-15', NOW)
  assert.equal(coverage.status, 'complete')
  assert.equal(coverage.effectiveDays, 31)
  assert.equal(coverage.complete, true)
}

function testCurrentMonthCountsToToday() {
  const coverage = monthCoverage('2026-11', '2026-09-15', NOW)
  assert.equal(coverage.status, 'current')
  assert.equal(coverage.startDay, 1)
  assert.equal(coverage.effectiveDays, 10)
  assert.equal(coverage.endDay, 10)
}

function testCurrentMonthCanAlsoBeTheFirstMonth() {
  const coverage = monthCoverage('2026-11', '2026-11-06', NOW)
  assert.equal(coverage.status, 'current')
  assert.equal(coverage.startDay, 6)
  assert.equal(coverage.effectiveDays, 5)
}

function testMonthsOutsideTheLedgerAreEmpty() {
  const before = monthCoverage('2026-08', '2026-09-15', NOW)
  assert.equal(before.status, 'before-start')
  assert.equal(before.effectiveDays, 0)
  assert.equal(before.startDay, 0)

  const future = monthCoverage('2026-12', '2026-09-15', NOW)
  assert.equal(future.status, 'future')
  assert.equal(future.effectiveDays, 0)
}

function testMissingStartMeansFullMonths() {
  const coverage = monthCoverage('2026-10', null, NOW)
  assert.equal(coverage.status, 'complete')
  assert.equal(coverage.effectiveDays, 31)
}

function testCompleteMonthsExcludeTheFirstAndCurrentMonth() {
  assert.equal(completeMonthsUpTo('2026-09-15', '2026-11', NOW), 1)
  assert.equal(completeMonthsUpTo('2026-09-01', '2026-11', NOW), 2)
}

function testManualOverrideWinsOverEarliestTransaction() {
  const transactions = [
    { date: '2026-09-20' },
    { date: '2026-10-02' },
  ] as unknown as LedgerTransaction[]
  assert.equal(
    resolveLedgerStartDate(transactions, null),
    '2026-09-20',
  )
  assert.equal(
    resolveLedgerStartDate(transactions, '2026-09-01'),
    '2026-09-01',
  )
}

function testEmptyLedgerHasNoStart() {
  assert.equal(resolveLedgerStartDate([], null), null)
}

function testFirstMonthBudgetIsProrated() {
  const currentMonth = `${NOW.getFullYear()}-${pad(NOW.getMonth() + 1)}`
  const startMonth = shiftMonth(currentMonth, -2)
  const startDate = `${startMonth}-11`
  const totalDays = daysInMonthOfKey(startMonth)
  const expectedDays = totalDays - 10
  const book: BudgetBook = {
    [startMonth]: {
      month: startMonth,
      amountCents: 300000,
      baseAmountCents: 300000,
      dailyMode: 'off',
    },
  }

  const metrics = getMonthBudgetMetrics([], startMonth, book, undefined, {
    startDate,
  })
  assert.equal(metrics.amountCents, Math.round((300000 * expectedDays) / totalDays))
  assert.equal(metrics.proration?.days, expectedDays)
  assert.equal(metrics.proration?.totalDays, totalDays)
  assert.equal(metrics.proration?.fullAmountCents, 300000)

  // A full month keeps the plan untouched.
  const fullMonth = shiftMonth(currentMonth, -1)
  const fullBook: BudgetBook = {
    [fullMonth]: {
      month: fullMonth,
      amountCents: 300000,
      baseAmountCents: 300000,
      dailyMode: 'off',
    },
  }
  const full = getMonthBudgetMetrics([], fullMonth, fullBook, undefined, {
    startDate,
  })
  assert.equal(full.amountCents, 300000)
  assert.equal(full.proration, undefined)
}

function main() {
  testFirstMonthStartsOnTheEntryDay()
  testPastMonthCoveredFromDayOneIsComplete()
  testCurrentMonthCountsToToday()
  testCurrentMonthCanAlsoBeTheFirstMonth()
  testMonthsOutsideTheLedgerAreEmpty()
  testMissingStartMeansFullMonths()
  testCompleteMonthsExcludeTheFirstAndCurrentMonth()
  testManualOverrideWinsOverEarliestTransaction()
  testEmptyLedgerHasNoStart()
  testFirstMonthBudgetIsProrated()
  console.log('coverage checks passed')
}

main()
