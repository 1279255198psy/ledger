/**
 * Standalone checks for the recurring-transaction planner. Run with:
 *   npm run test:recurring
 */
import assert from 'node:assert/strict'
import type {
  Account,
  AllocationLine,
  Category,
  LedgerTransaction,
  Project,
  RecurringFrequency,
  RecurringPending,
  RecurringRule,
  RecurringTemplate,
} from '../src/types'
import {
  addDays,
  diffDays,
  dueDatesForRule,
  firstOccurrenceOnOrAfter,
  formatDateKey,
  nextDueDate,
  nextOccurrenceAfter,
  normalizeRecurringPendings,
  normalizeRecurringRules,
  planRecurringCatchUp,
  previewOccurrences,
  reanchorFrequency,
  recurringPendingId,
  recurringTransactionId,
  resolveTemplate,
  weekdayNumber,
} from '../src/lib/recurring'
import { mergeSnapshots, snapshotsEqual } from '../src/lib/sync/merge'
import type { LedgerDataSnapshot } from '../src/lib/sync/types'

const DAY_MS = 24 * 60 * 60 * 1000

function isoDay(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  return Date.UTC(year, month - 1, day) / DAY_MS
}

const categories: Category[] = [
  { id: 'housing', name: '房租', type: 'expense' },
  { id: 'utilities', name: '水电', type: 'expense' },
  { id: 'salary', name: '工资', type: 'income' },
  { id: 'other_expense', name: '其他支出', type: 'expense' },
  { id: 'other_income', name: '其他收入', type: 'income' },
]

const accounts: Account[] = [
  { id: 'wechat', name: '微信', type: 'wechat' },
  { id: 'bank', name: '工资卡', type: 'bank' },
]

const projects: Project[] = [
  {
    id: 'trip',
    name: '旅行',
    status: 'active',
    startDate: '2026-01-01',
    currency: 'CNY',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
]

function dailyAlloc(amountCents: number): AllocationLine[] {
  return [
    {
      id: 'al-1',
      targetType: 'daily',
      amountCents,
      basis: 'ratio',
    },
  ]
}

function template(
  overrides: Partial<RecurringTemplate> = {},
): RecurringTemplate {
  const amountCents = overrides.amountCents ?? 350000
  return {
    type: 'expense',
    amountCents,
    categoryId: 'housing',
    accountId: 'bank',
    note: '房租',
    allocations: dailyAlloc(amountCents),
    ...overrides,
  }
}

function rule(overrides: Partial<RecurringRule> = {}): RecurringRule {
  return {
    id: 'rule-rent',
    schemaVersion: 1,
    enabled: true,
    template: template(),
    frequency: { kind: 'monthly', day: 1 },
    startDate: '2026-08-01',
    mode: 'auto',
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  }
}

function plan(
  rules: RecurringRule[],
  today: string,
  extra: {
    transactions?: LedgerTransaction[]
    pending?: RecurringPending[]
  } = {},
) {
  return planRecurringCatchUp({
    rules,
    transactions: extra.transactions ?? [],
    pending: extra.pending ?? [],
    categories,
    accounts,
    projects,
    today,
  })
}

function testMonthEndClamp() {
  const monthly31: RecurringFrequency = { kind: 'monthly', day: 31 }
  assert.equal(
    firstOccurrenceOnOrAfter(monthly31, '2026-01-31', '2026-02-01'),
    '2026-02-28',
  )
  assert.equal(
    firstOccurrenceOnOrAfter(monthly31, '2026-01-31', '2026-02-28'),
    '2026-02-28',
  )
  assert.equal(
    firstOccurrenceOnOrAfter(monthly31, '2026-01-31', '2026-03-01'),
    '2026-03-31',
  )
  // Leap year: February keeps its 29th.
  assert.equal(
    firstOccurrenceOnOrAfter(monthly31, '2028-01-31', '2028-02-01'),
    '2028-02-29',
  )
  // Every month clamps independently, so April follows February correctly.
  assert.deepEqual(
    previewOccurrences(
      { kind: 'monthly', day: 31 },
      '2026-01-31',
      4,
      '2026-05-31',
    ),
    ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'],
  )
}

function testWeeklyAndInterval() {
  const weekly: RecurringFrequency = { kind: 'weekly', weekday: 1 }
  const first = firstOccurrenceOnOrAfter(weekly, '2026-03-04', '2026-03-04')
  assert.ok(first)
  assert.equal(weekdayNumber(first), 1)
  assert.ok(diffDays('2026-03-04', first) >= 0)
  assert.ok(diffDays('2026-03-04', first) < 7)
  assert.equal(diffDays(first, nextOccurrenceAfter(weekly, '2026-03-04', first)!), 7)

  const every10: RecurringFrequency = { kind: 'interval', days: 10 }
  assert.equal(
    firstOccurrenceOnOrAfter(every10, '2026-01-01', '2026-01-01'),
    '2026-01-01',
  )
  assert.equal(
    firstOccurrenceOnOrAfter(every10, '2026-01-01', '2026-01-11'),
    '2026-01-11',
  )
  assert.equal(
    firstOccurrenceOnOrAfter(every10, '2026-01-01', '2026-01-12'),
    '2026-01-21',
  )
}

function testEndDateIsInclusive() {
  const rent = rule({
    frequency: { kind: 'monthly', day: 1 },
    startDate: '2026-01-01',
    endDate: '2026-03-01',
    mode: 'confirm',
  })
  assert.deepEqual(dueDatesForRule(rent, '2026-05-01'), [
    '2026-01-01',
    '2026-02-01',
    '2026-03-01',
  ])
  const result = plan([rent], '2026-05-01')
  assert.equal(result.newPendings.length, 3)
  // The cursor stops on the last period inside the window.
  assert.equal(result.rules[0].generatedThrough, '2026-03-01')
  assert.equal(nextDueDate(result.rules[0]), null)
}

function testNeverGeneratesFuturePeriods() {
  const rent = rule({
    frequency: { kind: 'monthly', day: 5 },
    startDate: '2026-09-01',
  })
  assert.deepEqual(dueDatesForRule(rent, '2026-10-29'), [
    '2026-09-05',
    '2026-10-05',
  ])
  const next = nextDueDate({ ...rent, generatedThrough: '2026-10-05' })
  assert.equal(next, '2026-11-05')
}

function testCatchUpIsIdempotent() {
  const rent = rule({
    mode: 'confirm',
    frequency: { kind: 'monthly', day: 1 },
    startDate: '2026-08-01',
  })
  const first = plan([rent], '2026-10-29')
  assert.deepEqual(
    first.newPendings.map((item) => item.id),
    [
      'rp:rule-rent:2026-08-01',
      'rp:rule-rent:2026-09-01',
      'rp:rule-rent:2026-10-01',
    ],
  )

  // Running again with the already-persisted state must add nothing.
  const second = plan(first.rules, '2026-10-29', {
    pending: first.newPendings,
  })
  assert.equal(second.changed, false)
  assert.equal(second.newPendings.length, 0)
  assert.equal(second.rules[0].generatedThrough, '2026-10-01')
}

function testAutoModeUsesDeterministicIds() {
  const auto = rule({ mode: 'auto', startDate: '2026-09-01' })
  const result = plan([auto], '2026-10-29')
  assert.deepEqual(
    result.newTransactions.map((item) => item.id),
    [
      recurringTransactionId('rule-rent', '2026-09-01'),
      recurringTransactionId('rule-rent', '2026-10-01'),
    ],
  )
  const created = result.newTransactions[0]
  assert.equal(created.recurringRuleId, 'rule-rent')
  assert.equal(created.recurringPeriod, '2026-09-01')
  assert.equal(created.date, '2026-09-01')
  assert.equal(created.createdAt, '2026-09-01T00:00:00.000Z')

  // An existing transaction with the same deterministic id blocks a duplicate.
  const blocked = plan([auto], '2026-10-29', {
    transactions: [created],
  })
  assert.equal(blocked.newTransactions.length, 1)
  assert.equal(blocked.newTransactions[0].date, '2026-10-01')
}

function testSwitchToAutoKeepsPendingPeriod() {
  const confirm = rule({ mode: 'confirm', startDate: '2026-09-01' })
  const first = plan([confirm], '2026-10-01')
  const switched = { ...first.rules[0], mode: 'auto' as const }
  const second = plan([switched], '2026-10-29', {
    pending: first.newPendings,
  })
  // Both due periods are already waiting for confirmation; switching the mode
  // must not record them behind the user's back.
  assert.equal(second.newTransactions.length, 0)
  assert.equal(second.newPendings.length, 0)
}

function testPausedRuleDoesNothing() {
  const paused = rule({ enabled: false, startDate: '2026-09-01' })
  assert.deepEqual(dueDatesForRule(paused, '2026-10-29'), [])
  const result = plan([paused], '2026-10-29')
  assert.equal(result.changed, false)
  assert.equal(result.newTransactions.length, 0)
}

function testResumeSkipsPausedGap() {
  const resumed = rule({
    startDate: '2026-01-01',
    generatedThrough: '2026-07-01',
  })
  const result = plan([resumed], '2026-10-29')
  assert.deepEqual(
    result.newTransactions.map((item) => item.date),
    ['2026-08-01', '2026-09-01', '2026-10-01'],
  )
}

function testLookbackAndOccurrenceCap() {
  const daily = rule({
    frequency: { kind: 'interval', days: 1 },
    startDate: '2020-01-01',
  })
  const dates = dueDatesForRule(daily, '2026-10-29')
  assert.equal(dates.length, 120)
  assert.equal(dates[dates.length - 1], '2026-10-29')
  const earliestAllowed = isoDay(addDays('2026-10-29', -366))
  assert.ok(isoDay(dates[0]) >= earliestAllowed)

  const yearly = rule({
    frequency: { kind: 'yearly', month: 2, day: 29 },
    startDate: '2024-02-29',
  })
  assert.deepEqual(
    previewOccurrences(yearly.frequency, yearly.startDate, 3),
    ['2024-02-29', '2025-02-28', '2026-02-28'],
  )
}

function testResolveTemplateRepairsDeletedReferences() {
  const withProject = template({
    allocations: [
      { id: 'al-1', targetType: 'daily', amountCents: 200000, basis: 'ratio' },
      {
        id: 'al-2',
        targetType: 'project',
        projectId: 'gone',
        amountCents: 150000,
        basis: 'ratio',
      },
    ],
  })
  const repaired = resolveTemplate(
    {
      ...withProject,
      categoryId: 'deleted-category',
      accountId: 'deleted-account',
    },
    categories,
    accounts,
    [],
  )
  assert.equal(repaired.categoryId, 'other_expense')
  assert.equal(repaired.accountId, 'wechat')
  assert.equal(
    repaired.allocations.reduce((sum, line) => sum + line.amountCents, 0),
    repaired.amountCents,
  )
  assert.ok(repaired.allocations.every((line) => line.targetType === 'daily'))
}

function testReanchorKeepsScheduleOnEditedDate() {
  assert.deepEqual(reanchorFrequency({ kind: 'monthly', day: 1 }, '2026-02-28'), {
    kind: 'monthly',
    day: 28,
  })
  assert.deepEqual(
    reanchorFrequency({ kind: 'yearly', month: 1, day: 1 }, '2026-07-09'),
    { kind: 'yearly', month: 7, day: 9 },
  )
  const weekly = reanchorFrequency(
    { kind: 'weekly', weekday: 0 },
    '2026-10-28',
  )
  assert.deepEqual(weekly, {
    kind: 'weekly',
    weekday: weekdayNumber('2026-10-28'),
  })
  // Interval rules are already anchored to the start date.
  assert.deepEqual(reanchorFrequency({ kind: 'interval', days: 7 }, '2026-10-28'), {
    kind: 'interval',
    days: 7,
  })
}

function testNormalization() {
  const valid = rule({ generatedThrough: '2026-09-01' })
  assert.equal(normalizeRecurringRules([valid, { id: 'bad' }], categories)?.length, 1)
  assert.equal(normalizeRecurringRules('nope', categories), null)

  const pending = normalizeRecurringPendings(
    [
      {
        id: 'wrong-id',
        ruleId: 'rule-rent',
        date: '2026-10-01',
        template: valid.template,
      },
      {
        id: 'orphan',
        ruleId: 'missing-rule',
        date: '2026-10-01',
        template: valid.template,
      },
    ],
    categories,
    new Set(['rule-rent']),
  )
  assert.equal(pending?.length, 1)
  assert.equal(pending?.[0].id, recurringPendingId('rule-rent', '2026-10-01'))
}

function snapshot(
  rules: RecurringRule[],
  pending: RecurringPending[] = [],
): LedgerDataSnapshot {
  return {
    app: '账页',
    syncVersion: 1,
    updatedAt: '2026-10-29T00:00:00.000Z',
    categories,
    accounts,
    transactions: [],
    projects,
    liabilities: [],
    budgets: {},
    budgetRanges: [],
    recurringRules: rules,
    recurringPending: pending,
    openingBalanceCents: 0,
  }
}

function testMergeReconcilesCursorsQuietly() {
  const base = rule({
    mode: 'confirm',
    generatedThrough: '2026-08-01',
  })
  const phone = { ...base, generatedThrough: '2026-09-01' }
  const desktop = { ...base, generatedThrough: '2026-10-01' }

  const first = mergeSnapshots(
    snapshot([base]),
    snapshot([phone]),
    snapshot([desktop]),
  )
  assert.equal(first.snapshot.recurringRules?.[0].generatedThrough, '2026-10-01')
  assert.equal(
    first.conflicts.filter((item) => item.kind === 'recurringRule').length,
    0,
  )

  const second = mergeSnapshots(
    snapshot([base]),
    snapshot([desktop]),
    snapshot([phone]),
  )
  assert.ok(snapshotsEqual(first.snapshot, second.snapshot))
}

function testMergeKeepsRealRuleEditsAndDropsOrphans() {
  const base = rule({ startDate: '2026-08-01' })
  const edited = {
    ...base,
    template: { ...base.template, amountCents: 380000, allocations: dailyAlloc(380000) },
    updatedAt: '2026-10-20T00:00:00.000Z',
  }
  const result = mergeSnapshots(
    snapshot([base]),
    snapshot([base]),
    snapshot([edited]),
  )
  assert.equal(result.snapshot.recurringRules?.[0].template.amountCents, 380000)

  const orphan: RecurringPending = {
    id: recurringPendingId('missing', '2026-10-01'),
    ruleId: 'missing',
    date: '2026-10-01',
    template: base.template,
    createdAt: '2026-10-01T00:00:00.000Z',
  }
  const cleaned = mergeSnapshots(
    snapshot([base]),
    snapshot([base]),
    snapshot([], [orphan]),
  )
  assert.deepEqual(cleaned.snapshot.recurringPending, [])
}

function testOlderPeerKeepsLocalRules() {
  const local = rule()
  const legacy: LedgerDataSnapshot = snapshot([])
  delete legacy.recurringRules
  delete legacy.recurringPending
  const result = mergeSnapshots(null, snapshot([local]), legacy)
  assert.equal(result.snapshot.recurringRules?.length, 1)
  assert.equal(result.snapshot.recurringRules?.[0].id, 'rule-rent')
}

function testFormattingHelpers() {
  assert.equal(addDays('2026-02-28', 1), '2026-03-01')
  assert.equal(addDays('2028-02-28', 1), '2028-02-29')
  assert.equal(formatDateKey(2026, 1, 5), '2026-01-05')
  assert.equal(diffDays('2026-01-01', '2026-01-31'), 30)
}

const tests: Array<[string, () => void]> = [
  ['month-end clamping', testMonthEndClamp],
  ['weekly and interval', testWeeklyAndInterval],
  ['end date is inclusive', testEndDateIsInclusive],
  ['never generates future periods', testNeverGeneratesFuturePeriods],
  ['catch-up is idempotent', testCatchUpIsIdempotent],
  ['auto mode uses deterministic ids', testAutoModeUsesDeterministicIds],
  ['switching to auto keeps pending periods', testSwitchToAutoKeepsPendingPeriod],
  ['paused rule does nothing', testPausedRuleDoesNothing],
  ['resume skips paused gap', testResumeSkipsPausedGap],
  ['lookback and occurrence cap', testLookbackAndOccurrenceCap],
  ['template repairs deleted references', testResolveTemplateRepairsDeletedReferences],
  ['re-anchor on edited date', testReanchorKeepsScheduleOnEditedDate],
  ['normalization', testNormalization],
  ['merge reconciles cursors quietly', testMergeReconcilesCursorsQuietly],
  ['merge keeps real edits and drops orphans', testMergeKeepsRealRuleEditsAndDropsOrphans],
  ['older peer keeps local rules', testOlderPeerKeepsLocalRules],
  ['formatting helpers', testFormattingHelpers],
]

let failed = 0
for (const [name, run] of tests) {
  try {
    run()
    console.log(`✓ ${name}`)
  } catch (error) {
    failed += 1
    console.error(`✗ ${name}`)
    console.error(error)
  }
}

if (failed > 0) {
  console.error(`\n${failed} recurring test(s) failed`)
  process.exit(1)
}
console.log(`\n${tests.length} recurring tests passed`)
