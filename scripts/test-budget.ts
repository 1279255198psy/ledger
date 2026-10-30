/**
 * Standalone checks for dynamic budget adjustments. Run with:
 *   npm run test:budget
 */
import assert from 'node:assert/strict'
import {
  applyBudgetAdjustment,
  getMonthBudgetMetrics,
  normalizeBudgetBook,
  normalizeMonthBudget,
  resolveMonthBudget,
  rescheduleRemainingDailyAmounts,
} from '../src/lib/budget'
import type { BudgetBook, MonthBudget, MonthBudgetMetrics } from '../src/types'

const AT = '2026-10-30T10:00:00.000Z'

function plan(overrides: Partial<MonthBudget> = {}): MonthBudget {
  return {
    month: '2026-10',
    amountCents: 800000,
    baseAmountCents: 800000,
    dailyMode: 'off',
    ...overrides,
  }
}

function testLegacyRecordsGetABaseline() {
  const legacy = normalizeMonthBudget(
    { month: '2026-10', amountCents: 800000, dailyMode: 'off' },
    '2026-10',
  )
  assert.ok(legacy)
  assert.equal(legacy.baseAmountCents, 800000)
  assert.equal(legacy.adjustments, undefined)
}

function testAdjustmentKeepsTheOriginalPlan() {
  const next = applyBudgetAdjustment(plan(), {
    amountCents: 700000,
    note: '本月花得比计划少',
    at: AT,
  })
  assert.equal(next.amountCents, 700000)
  assert.equal(next.baseAmountCents, 800000)
  assert.equal(next.adjustments?.length, 1)
  const entry = next.adjustments?.[0]
  assert.ok(entry)
  assert.equal(entry.beforeCents, 800000)
  assert.equal(entry.afterCents, 700000)
  assert.equal(entry.deltaCents, -100000)
  assert.equal(entry.kind, 'adjust')
  assert.equal(entry.note, '本月花得比计划少')
  assert.equal(entry.at, AT)
}

function testUnchangedAmountIsNotLogged() {
  const adjusted = applyBudgetAdjustment(plan(), {
    amountCents: 700000,
    note: '下调',
    at: AT,
  })
  const same = applyBudgetAdjustment(adjusted, {
    amountCents: 700000,
    note: '再按一次保存',
    at: '2026-10-31T10:00:00.000Z',
  })
  assert.equal(same.amountCents, 700000)
  assert.equal(same.adjustments?.length, 1)
}

function testReplanRebasesWithoutLosingHistory() {
  const adjusted = applyBudgetAdjustment(plan(), {
    amountCents: 700000,
    note: '下调',
    at: AT,
  })
  const replanned = applyBudgetAdjustment(adjusted, {
    amountCents: 900000,
    note: '重新制定本月预算',
    kind: 'replan',
    rebase: true,
    at: '2026-10-31T10:00:00.000Z',
  })
  assert.equal(replanned.amountCents, 900000)
  assert.equal(replanned.baseAmountCents, 900000)
  assert.equal(replanned.adjustments?.length, 2)
  assert.equal(replanned.adjustments?.[1]?.beforeCents, 700000)
  assert.equal(replanned.adjustments?.[1]?.afterCents, 900000)
  assert.equal(replanned.adjustments?.[1]?.kind, 'replan')
}

function testBackToBackChangesAccumulate() {
  let budget = plan()
  budget = applyBudgetAdjustment(budget, {
    amountCents: 750000,
    note: '先下调',
    at: AT,
  })
  budget = applyBudgetAdjustment(budget, {
    amountCents: 820000,
    note: '再加回一点',
    at: '2026-10-30T11:00:00.000Z',
  })
  assert.equal(budget.amountCents, 820000)
  assert.equal(budget.baseAmountCents, 800000)
  assert.deepEqual(
    budget.adjustments?.map((entry) => entry.deltaCents),
    [-50000, 70000],
  )
}

function testNormalizationDropsBrokenEntries() {
  const normalized = normalizeMonthBudget(
    {
      month: '2026-10',
      amountCents: 700000,
      baseAmountCents: 800000,
      dailyMode: 'off',
      adjustments: [
        { id: 'bad', at: 'not-a-date', beforeCents: 800000, afterCents: 700000 },
        {
          id: 'good',
          at: AT,
          beforeCents: 800000,
          afterCents: 700000,
          note: '有效记录',
          kind: 'adjust',
        },
      ],
    },
    '2026-10',
  )
  assert.ok(normalized)
  assert.equal(normalized.adjustments?.length, 1)
  assert.equal(normalized.adjustments?.[0]?.id, 'good')
  assert.equal(normalized.adjustments?.[0]?.deltaCents, -100000)
}

function testInheritedMonthDoesNotCarryTheLog() {
  const adjusted = applyBudgetAdjustment(plan(), {
    amountCents: 700000,
    note: '九月下调',
    at: AT,
  })
  const book: BudgetBook = { '2026-09': { ...adjusted, month: '2026-09' } }
  const resolved = resolveMonthBudget(book, '2026-10')
  assert.equal(resolved.source, 'inherited')
  assert.equal(resolved.budget.amountCents, 700000)
  assert.equal(resolved.budget.adjustments, undefined)
  assert.equal(resolved.budget.baseAmountCents, undefined)
}

function testMetricsExposeTheAdjustment() {
  const adjusted = applyBudgetAdjustment(plan(), {
    amountCents: 700000,
    note: '本月下调',
    at: AT,
  })
  const metrics = getMonthBudgetMetrics([], '2026-10', {
    '2026-10': adjusted,
  })
  assert.equal(metrics.amountCents, 700000)
  assert.equal(metrics.baseAmountCents, 800000)
  assert.equal(metrics.adjustedDeltaCents, -100000)
  assert.equal(metrics.adjustments.length, 1)
}

function testReschedulingKeepsPastDaysAndSplitsTheRest() {
  const metrics = {
    daily: {
      isLive: true,
      today: 3,
      days: [
        { budgetCents: 10000, spentCents: 9000 },
        { budgetCents: 10000, spentCents: 1000 },
        { budgetCents: 10000, spentCents: 0 },
        { budgetCents: 10000, spentCents: 0 },
        { budgetCents: 10000, spentCents: 0 },
      ],
    },
  } as unknown as MonthBudgetMetrics

  const daily = rescheduleRemainingDailyAmounts(metrics, 58000)
  assert.ok(daily)
  assert.equal(daily['1'], 10000)
  assert.equal(daily['2'], 10000)
  // 58000 - spentBeforeToday(10000) = 48000 over 3 days.
  assert.equal(daily['3'], 16000)
  assert.equal(daily['4'], 16000)
  assert.equal(daily['5'], 16000)
}

function testBookNormalizationKeepsGoodMonths() {
  const book = normalizeBudgetBook({
    '2026-10': {
      amountCents: 700000,
      baseAmountCents: 800000,
      dailyMode: 'off',
      adjustments: [
        {
          id: 'entry-1',
          at: AT,
          beforeCents: 800000,
          afterCents: 700000,
          note: '本月下调',
          kind: 'adjust',
        },
      ],
    },
    'broken-month': { amountCents: 100 },
    '2026-11': { amountCents: 0, dailyMode: 'off' },
  })
  assert.ok(book)
  assert.deepEqual(Object.keys(book), ['2026-10'])
  assert.equal(book['2026-10']?.baseAmountCents, 800000)
  assert.equal(book['2026-10']?.adjustments?.length, 1)
}

function main() {
  testLegacyRecordsGetABaseline()
  testAdjustmentKeepsTheOriginalPlan()
  testUnchangedAmountIsNotLogged()
  testReplanRebasesWithoutLosingHistory()
  testBackToBackChangesAccumulate()
  testNormalizationDropsBrokenEntries()
  testInheritedMonthDoesNotCarryTheLog()
  testMetricsExposeTheAdjustment()
  testReschedulingKeepsPastDaysAndSplitsTheRest()
  testBookNormalizationKeepsGoodMonths()
  console.log('budget checks passed')
}

main()
