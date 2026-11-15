/**
 * Standalone checks for project-period soft validation and pre/post tags.
 * Run with:
 *   npm run test:project-timing
 */
import assert from 'node:assert/strict'
import {
  clampDateToProject,
  getProjectTimingTotals,
  projectTimingForDate,
  projectTimingLabel,
  transactionTimingHits,
} from '../src/lib/projectTiming'
import type {
  AllocationLine,
  LedgerTransaction,
  Project,
} from '../src/types'

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project-a',
    name: '装修',
    status: 'active',
    startDate: '2026-03-01',
    endDate: '2026-05-31',
    currency: 'CNY',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-05-31T00:00:00.000Z',
    ...overrides,
  }
}

function allocation(
  projectId: string,
  amountCents: number,
  id = `al-${projectId}-${amountCents}`,
): AllocationLine {
  return {
    id,
    targetType: 'project',
    projectId,
    amountCents,
    weight: 1,
    ratioBp: 10000,
    basis: 'ratio',
  }
}

function transaction(
  date: string,
  amountCents: number,
  allocations: AllocationLine[],
  type: LedgerTransaction['type'] = 'expense',
): LedgerTransaction {
  return {
    id: `txn-${date}-${amountCents}-${type}`,
    schemaVersion: 2,
    type,
    amountCents,
    categoryId: 'food',
    accountId: 'wechat',
    date,
    note: '',
    allocations,
    createdAt: `${date}T00:00:00.000Z`,
  }
}

function testBoundaries() {
  const item = project()
  assert.equal(projectTimingForDate(item, '2026-02-28'), 'pre')
  assert.equal(projectTimingForDate(item, '2026-03-01'), null)
  assert.equal(projectTimingForDate(item, '2026-05-31'), null)
  assert.equal(projectTimingForDate(item, '2026-06-01'), 'post')
}

function testOpenEndedProjectHasNoPostBound() {
  const item = project({ endDate: undefined })
  assert.equal(projectTimingForDate(item, '2030-01-01'), null)
  assert.equal(projectTimingForDate(item, '2026-02-01'), 'pre')
}

function testClosedProjectFallsBackToUpdatedAt() {
  const item = project({
    endDate: undefined,
    status: 'closed',
    updatedAt: '2026-07-15T00:00:00.000Z',
  })
  assert.equal(projectTimingForDate(item, '2026-07-15'), null)
  assert.equal(projectTimingForDate(item, '2026-07-16'), 'post')
}

function testClampKeepsDatesInsideThePeriod() {
  const item = project()
  assert.equal(clampDateToProject(item, '2026-01-01'), '2026-03-01')
  assert.equal(clampDateToProject(item, '2026-04-10'), '2026-04-10')
  assert.equal(clampDateToProject(item, '2026-09-01'), '2026-05-31')
}

function testLabelsFollowTransactionType() {
  assert.equal(projectTimingLabel('pre', 'expense'), '前置支出')
  assert.equal(projectTimingLabel('post', 'expense'), '后置支出')
  assert.equal(projectTimingLabel('pre', 'income'), '前置收入')
  assert.equal(projectTimingLabel('post', 'income'), '后置收入')
}

function testSharedEntryFlagsOnlyOutOfRangeProjects() {
  const early = project({ id: 'project-a', name: 'A' })
  const late = project({
    id: 'project-b',
    name: 'B',
    startDate: '2026-06-01',
    endDate: '2026-08-31',
  })
  const entry = transaction(
    '2026-05-20',
    20000,
    [allocation('project-a', 10000), allocation('project-b', 10000)],
    'expense',
  )
  const hits = transactionTimingHits(entry, [early, late])
  assert.deepEqual(
    hits.map((hit) => [hit.project.id, hit.timing]),
    [['project-b', 'pre']],
  )
  assert.deepEqual(
    transactionTimingHits(entry, [early, late], 'project-a'),
    [],
  )
}

function testTotalsSeparatePreAndPostMoney() {
  const item = project()
  const entries = [
    transaction('2026-02-10', 10000, [allocation('project-a', 10000)]),
    transaction('2026-04-10', 20000, [allocation('project-a', 20000)]),
    transaction('2026-06-10', 30000, [allocation('project-a', 30000)]),
    transaction('2026-06-11', 5000, [allocation('project-a', 5000)], 'income'),
  ]
  const totals = getProjectTimingTotals(entries, item)
  assert.equal(totals.preExpenseCents, 10000)
  assert.equal(totals.preExpenseCount, 1)
  assert.equal(totals.postExpenseCents, 30000)
  assert.equal(totals.postExpenseCount, 1)
  assert.equal(totals.postIncomeCents, 5000)
  assert.equal(totals.postIncomeCount, 1)
  assert.equal(totals.preIncomeCents, 0)
}

testBoundaries()
testOpenEndedProjectHasNoPostBound()
testClosedProjectFallsBackToUpdatedAt()
testClampKeepsDatesInsideThePeriod()
testLabelsFollowTransactionType()
testSharedEntryFlagsOnlyOutOfRangeProjects()
testTotalsSeparatePreAndPostMoney()
console.log('project timing tests passed')
