/**
 * Standalone checks for the savings model. Run with:
 *   npm run test:savings
 */
import assert from 'node:assert/strict'
import type { LedgerTransaction, SavingsHolding } from '../src/types'
import {
  buildGoalSettlement,
  expectedInterestCents,
  getGoalUsage,
  getSavingsSummary,
  getSavingsTotals,
  getSavingsTransfers,
  goalCoveredCents,
  isValidSavingsHolding,
  renewSavingsHolding,
  savingsBalanceAt,
  savingsLiquidNetCents,
  sortSavingsHoldings,
} from '../src/lib/savings'

const today = '2026-11-18'

function holding(
  partial: Partial<SavingsHolding> = {},
): SavingsHolding {
  return {
    id: 's1',
    name: '三年定期',
    kind: 'fixed',
    principalCents: 1000000,
    annualRateBps: 260,
    startDate: '2026-01-01',
    maturityDate: '2029-01-01',
    entries: [
      {
        id: 'e1',
        kind: 'deposit',
        amountCents: 1000000,
        date: '2026-01-01',
        source: 'external',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partial,
  }
}

function testBalanceAndInterest() {
  const item = holding()
  const summary = getSavingsSummary(item, today)
  assert.equal(summary.balanceCents, 1000000)
  assert.equal(summary.matured, false)
  const interest = expectedInterestCents(item)
  assert.ok(interest > 0)
  assert.equal(summary.expectedMaturityCents, 1000000 + interest)

  const withEntries = holding({
    entries: [
      ...item.entries,
      {
        id: 'e2',
        kind: 'interest',
        amountCents: 1234,
        date: '2026-06-01',
        createdAt: '2026-06-01T00:00:00.000Z',
      },
      {
        id: 'e3',
        kind: 'withdraw',
        amountCents: 5000,
        date: '2026-07-01',
        createdAt: '2026-07-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(getSavingsSummary(withEntries, today).balanceCents, 996234)
  assert.equal(savingsBalanceAt([withEntries], '2026-06-30'), 1001234)
  assert.equal(savingsBalanceAt([withEntries], '2026-07-01'), 1001234 - 5000)
}

function testLiquidNet() {
  const external = holding()
  assert.equal(savingsLiquidNetCents([external]), 0)

  const fromLedger = holding({
    entries: [
      {
        id: 'e1',
        kind: 'deposit',
        amountCents: 1000000,
        date: '2026-01-01',
        source: 'ledger',
        accountId: 'bank',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(savingsLiquidNetCents([fromLedger]), 1000000)
  assert.equal(savingsLiquidNetCents([fromLedger], '2025-12-31'), 0)

  const withdrawn = holding({
    entries: [
      ...fromLedger.entries,
      {
        id: 'e2',
        kind: 'withdraw',
        amountCents: 400000,
        date: '2026-08-01',
        createdAt: '2026-08-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(savingsLiquidNetCents([withdrawn]), 600000)
  assert.equal(savingsLiquidNetCents([withdrawn], '2026-07-31'), 1000000)

  const transfers = getSavingsTransfers([fromLedger, withdrawn])
  assert.equal(transfers.length, 3)
  assert.equal(
    transfers.filter((item) => item.direction === 'toSavings').length,
    2,
  )
}

function testClosedHoldingCounts() {
  const item = holding({
    closedAt: '2026-09-01',
    entries: [
      {
        id: 'e1',
        kind: 'deposit',
        amountCents: 1000000,
        date: '2026-01-01',
        source: 'external',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'e2',
        kind: 'withdraw',
        amountCents: 1000000,
        date: '2026-09-01',
        createdAt: '2026-09-01T00:00:00.000Z',
      },
    ],
  })
  assert.equal(getSavingsTotals([item], today).balanceCents, 0)
  assert.equal(savingsBalanceAt([item], '2026-08-31'), 1000000)
  assert.equal(savingsBalanceAt([item], '2026-09-01'), 0)
}

function testRenewalDoesNotDoubleCount() {
  const item = holding({
    startDate: '2023-01-01',
    maturityDate: '2026-01-01',
    entries: [
      {
        id: 'e1',
        kind: 'deposit',
        amountCents: 1000000,
        date: '2023-01-01',
        source: 'external',
        createdAt: '2023-01-01T00:00:00.000Z',
      },
    ],
  })
  const before = getSavingsTotals([item], today).balanceCents
  const renewed = renewSavingsHolding(item)
  assert.ok(renewed)
  const after = getSavingsTotals(
    [renewed.closed, renewed.created],
    today,
  ).balanceCents
  assert.ok(after > before)
  assert.equal(renewed.created.renewedFromId, item.id)
  assert.equal(renewed.closed.closedAt, item.maturityDate)
  assert.ok(renewed.created.startDate > item.startDate)
}

function testSortAndValidation() {
  const matured = holding({
    id: 'matured',
    maturityDate: '2026-01-01',
  })
  const active = holding({ id: 'active' })
  const closed = holding({ id: 'closed', closedAt: '2026-02-01' })
  assert.deepEqual(
    sortSavingsHoldings([closed, active, matured], today).map(
      (item) => item.id,
    ),
    ['matured', 'active', 'closed'],
  )

  assert.equal(isValidSavingsHolding(holding()), true)
  assert.equal(
    isValidSavingsHolding(holding({ principalCents: 0 })),
    false,
  )
  assert.equal(
    isValidSavingsHolding(
      holding({
        entries: [
          {
            id: 'bad',
            kind: 'deposit',
            amountCents: -1,
            date: '2026-01-01',
            createdAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    ),
    false,
  )
}

function goalHolding(): SavingsHolding {
  return {
    id: 'goal-1',
    name: '旅行基金',
    kind: 'goal',
    principalCents: 100000,
    startDate: '2026-01-01',
    entries: [
      {
        id: 'g1',
        kind: 'deposit',
        amountCents: 100000,
        date: '2026-01-01',
        source: 'ledger',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    goalTargetCents: 100000,
    goalProjectId: 'p1',
    goalStartedAt: '2026-02-01',
    goalStatus: 'using',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

function projectExpense(
  id: string,
  amountCents: number,
  date: string,
  kind?: 'refund',
): LedgerTransaction {
  return {
    id,
    schemaVersion: 2,
    type: 'expense',
    amountCents,
    categoryId: 'other_expense',
    accountId: 'bank',
    date,
    note: id,
    ...(kind ? { kind } : {}),
    allocations: [
      {
        id: `${id}-al`,
        targetType: 'project',
        projectId: 'p1',
        amountCents,
      },
    ],
    createdAt: `${date}T00:00:00.000Z`,
  }
}

function testGoalUsageAndSettlement() {
  const goal = goalHolding()
  const transactions = [
    projectExpense('t1', 30000, '2026-02-10'),
    projectExpense('t2', 5000, '2026-03-01', 'refund'),
    projectExpense('t3', 20000, '2026-01-15'), // before the goal started
  ]
  const usage = getGoalUsage(goal, transactions, '2026-03-31')
  assert.equal(usage.rawSpendCents, 25000)
  assert.equal(usage.coveredCents, 25000)
  assert.equal(usage.overageCents, 0)
  assert.equal(
    getSavingsSummary(goal, '2026-03-31', transactions).balanceCents,
    75000,
  )
  assert.equal(
    savingsBalanceAt([goal], '2026-03-31', transactions),
    75000,
  )
  assert.equal(
    goalCoveredCents([goal], transactions, '2026-03-31'),
    25000,
  )

  const settlement = buildGoalSettlement(goal, transactions, {
    date: '2026-03-31',
    now: '2026-03-31T10:00:00.000Z',
  })
  assert.ok(settlement)
  assert.equal(settlement.spentCents, 25000)
  assert.equal(settlement.coveredCents, 25000)
  assert.equal(settlement.remainingCents, 75000)
  assert.equal(settlement.closed.goalStatus, 'settled')
  assert.equal(settlement.closed.closedAt, '2026-03-31')
  assert.equal(
    getSavingsSummary(settlement.closed, '2026-03-31').balanceCents,
    0,
  )
  // After settlement the derived usage is replaced by the closing entries.
  assert.equal(
    getGoalUsage(settlement.closed, transactions, '2026-03-31').coveredCents,
    0,
  )
}

function testGoalOverageAndNoProjectSettlement() {
  const goal = {
    ...goalHolding(),
    entries: [
      {
        id: 'g1',
        kind: 'deposit' as const,
        amountCents: 10000,
        date: '2026-01-01',
        source: 'external' as const,
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
  }
  const transactions = [projectExpense('t1', 30000, '2026-02-10')]
  const usage = getGoalUsage(goal, transactions, '2026-03-31')
  assert.equal(usage.rawSpendCents, 30000)
  assert.equal(usage.coveredCents, 10000)
  assert.equal(usage.overageCents, 20000)

  const plain = buildGoalSettlement(
    {
      ...goal,
      goalProjectId: undefined,
      goalStatus: 'saving',
    },
    [],
    {
      spentCents: 8000,
      writeToFlow: true,
      date: '2026-03-31',
      now: '2026-03-31T10:00:00.000Z',
    },
  )
  assert.ok(plain)
  assert.equal(plain.coveredCents, 8000)
  assert.equal(plain.remainingCents, 2000)
  assert.equal(plain.closed.closedAt, '2026-03-31')
}

function main() {
  testBalanceAndInterest()
  testLiquidNet()
  testClosedHoldingCounts()
  testRenewalDoesNotDoubleCount()
  testGoalUsageAndSettlement()
  testGoalOverageAndNoProjectSettlement()
  testSortAndValidation()
  console.log('savings checks passed')
}

main()
