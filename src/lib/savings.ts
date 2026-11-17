import type {
  GoalSettlement,
  GoalUsage,
  LedgerTransaction,
  SavingsEntry,
  SavingsHolding,
  SavingsKind,
  SavingsSource,
  SavingsSummary,
  SavingsTransfer,
} from '../types'
import { allocationDeltaCents } from './refunds'
import { localDateKey } from './utils'

const DAY_MS = 24 * 60 * 60 * 1000

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function newSavingsId(): string {
  return makeId('savings')
}

export function newSavingsEntryId(): string {
  return makeId('savings-entry')
}

function isDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function parseDateKey(value: string): Date | null {
  if (!isDateKey(value)) return null
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const start = parseDateKey(from)
  const end = parseDateKey(to)
  if (!start || !end) return 0
  return Math.round((end.getTime() - start.getTime()) / DAY_MS)
}

export function addDaysToKey(dateKey: string, days: number): string {
  const date = parseDateKey(dateKey)
  if (!date) return dateKey
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
    2,
    '0',
  )}-${String(date.getDate()).padStart(2, '0')}`
}

const ENTRY_KINDS = new Set(['deposit', 'withdraw', 'interest', 'adjust'])
const SAVINGS_KINDS = new Set([
  'fixed',
  'large',
  'bond',
  'wealth',
  'fund',
  'housing',
  'goal',
  'other',
])

export function isSavingsKind(value: unknown): value is SavingsKind {
  return typeof value === 'string' && SAVINGS_KINDS.has(value)
}

export function isSavingsEntry(value: unknown): value is SavingsEntry {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<SavingsEntry>
  if (
    typeof item.id !== 'string' ||
    item.id.length === 0 ||
    item.id.length > 80 ||
    typeof item.kind !== 'string' ||
    !ENTRY_KINDS.has(item.kind) ||
    !Number.isInteger(item.amountCents) ||
    !isDateKey(item.date) ||
    typeof item.createdAt !== 'string'
  ) {
    return false
  }
  if (item.note !== undefined) {
    if (typeof item.note !== 'string' || item.note.length > 200) return false
  }
  if (item.source !== undefined) {
    if (item.source !== 'ledger' && item.source !== 'external') return false
  }
  if (item.accountId !== undefined) {
    if (typeof item.accountId !== 'string' || item.accountId.length > 80) {
      return false
    }
  }
  // Balance-type holdings record the signed difference in an `adjust` entry.
  return item.kind === 'adjust'
    ? Number(item.amountCents) !== 0
    : Number(item.amountCents) > 0
}

export function isValidSavingsHolding(value: unknown): value is SavingsHolding {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<SavingsHolding>
  if (
    typeof item.id !== 'string' ||
    item.id.length === 0 ||
    item.id.length > 80 ||
    typeof item.name !== 'string' ||
    item.name.trim().length === 0 ||
    item.name.trim().length > 40 ||
    !isSavingsKind(item.kind) ||
    !Number.isInteger(item.principalCents) ||
    Number(item.principalCents) < 0 ||
    (item.kind !== 'goal' && Number(item.principalCents) <= 0) ||
    !isDateKey(item.startDate) ||
    !Array.isArray(item.entries) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return false
  }
  if (item.institution !== undefined) {
    if (typeof item.institution !== 'string' || item.institution.length > 40) {
      return false
    }
  }
  if (item.annualRateBps !== undefined) {
    if (
      !Number.isFinite(item.annualRateBps) ||
      Number(item.annualRateBps) < 0 ||
      Number(item.annualRateBps) > 100_00
    ) {
      return false
    }
  }
  if (item.maturityDate !== undefined && !isDateKey(item.maturityDate)) {
    return false
  }
  if (item.note !== undefined) {
    if (typeof item.note !== 'string' || item.note.length > 200) return false
  }
  if (item.closedAt !== undefined && !isDateKey(item.closedAt)) return false
  if (item.renewedFromId !== undefined) {
    if (typeof item.renewedFromId !== 'string' || item.renewedFromId.length > 80) {
      return false
    }
  }
  if (item.kind === 'goal') {
    if (
      !Number.isInteger(item.goalTargetCents) ||
      Number(item.goalTargetCents) <= 0
    ) {
      return false
    }
    if (item.goalDate !== undefined && !isDateKey(item.goalDate)) return false
    if (
      item.goalProjectId !== undefined &&
      (typeof item.goalProjectId !== 'string' ||
        item.goalProjectId.length > 80)
    ) {
      return false
    }
    if (item.goalStartedAt !== undefined && !isDateKey(item.goalStartedAt)) {
      return false
    }
    if (
      item.goalStatus !== undefined &&
      item.goalStatus !== 'saving' &&
      item.goalStatus !== 'using' &&
      item.goalStatus !== 'settled'
    ) {
      return false
    }
    if (item.goalSettledAt !== undefined && !isDateKey(item.goalSettledAt)) {
      return false
    }
  } else if (
    item.goalTargetCents !== undefined ||
    item.goalProjectId !== undefined ||
    item.goalStatus !== undefined
  ) {
    return false
  }
  if (!item.entries.every(isSavingsEntry)) return false
  const ids = new Set(item.entries.map((entry) => entry.id))
  if (ids.size !== item.entries.length) return false
  return signedBalance(item as SavingsHolding) >= 0
}

function signedBalance(holding: SavingsHolding): number {
  let balance = 0
  for (const entry of holding.entries) {
    if (entry.kind === 'withdraw') balance -= entry.amountCents
    else balance += entry.amountCents
  }
  return balance
}

/** Current or historical balance, regardless of whether the holding is closed. */
export function savingsBalance(holding: SavingsHolding): number {
  return Math.max(signedBalance(holding), 0)
}

export function expectedInterestCents(holding: SavingsHolding): number {
  if (
    !holding.maturityDate ||
    !holding.annualRateBps ||
    holding.annualRateBps <= 0 ||
    holding.principalCents <= 0
  ) {
    return 0
  }
  const days = Math.max(daysBetween(holding.startDate, holding.maturityDate), 0)
  return Math.round(
    (holding.principalCents * holding.annualRateBps * days) /
      (10_000 * 365),
  )
}

export function getSavingsSummary(
  holding: SavingsHolding,
  today = localDateKey(),
  transactions: LedgerTransaction[] = [],
): SavingsSummary {
  const availableCents = savingsBalanceThrough(holding, today)
  const usage = getGoalUsage(holding, transactions, today)
  const balanceCents = Math.max(availableCents - usage.coveredCents, 0)
  let depositedCents = 0
  let withdrawnCents = 0
  let interestCents = 0
  for (const entry of holding.entries) {
    if (entry.kind === 'deposit') depositedCents += entry.amountCents
    else if (entry.kind === 'withdraw') withdrawnCents += entry.amountCents
    else if (entry.kind === 'interest') interestCents += entry.amountCents
  }
  // Once the actual interest is recorded, the balance already contains it;
  // adding the estimate again would make the maturity value look too high.
  const hasRecordedInterest = holding.entries.some(
    (entry) => entry.kind === 'interest',
  )
  const expected = hasRecordedInterest
    ? 0
    : expectedInterestCents(holding)
  const closed = Boolean(holding.closedAt)
  const daysToMaturity = holding.maturityDate
    ? daysBetween(today, holding.maturityDate)
    : null
  const totalDays = holding.maturityDate
    ? Math.max(daysBetween(holding.startDate, holding.maturityDate), 1)
    : 0
  const elapsedDays = holding.maturityDate
    ? Math.max(daysBetween(holding.startDate, today), 0)
    : 0
  return {
    balanceCents,
    depositedCents,
    withdrawnCents,
    interestCents,
    expectedInterestCents: expected,
    expectedMaturityCents: balanceCents + expected,
    termProgress:
      totalDays > 0 ? Math.min(Math.max(elapsedDays / totalDays, 0), 1) : 0,
    daysToMaturity,
    matured:
      !closed &&
      holding.maturityDate !== undefined &&
      holding.maturityDate <= today,
    closed,
  }
}

export function isHoldingActiveAt(
  holding: SavingsHolding,
  dateKey: string,
): boolean {
  if (holding.startDate > dateKey) return false
  if (holding.closedAt && holding.closedAt <= dateKey) return false
  return true
}

/** Savings balance as of a date, counting entries recorded on or before it. */
export function savingsBalanceAt(
  holdings: SavingsHolding[],
  dateKey: string,
  transactions: LedgerTransaction[] = [],
): number {
  let total = 0
  for (const holding of holdings) {
    if (!isHoldingActiveAt(holding, dateKey)) continue
    const balance = savingsBalanceThrough(holding, dateKey)
    const usage = getGoalUsage(holding, transactions, dateKey)
    total += Math.max(balance - usage.coveredCents, 0)
  }
  return total
}

export function savingsBalanceThrough(
  holding: SavingsHolding,
  dateKey: string,
): number {
  let balance = 0
  for (const entry of holding.entries) {
    if (entry.date > dateKey) continue
    if (entry.kind === 'withdraw') balance -= entry.amountCents
    else balance += entry.amountCents
  }
  return Math.max(balance, 0)
}

/**
 * How much of a linked project's spending is paid from this goal pot. The
 * project's own transactions stay in the ledger; this figure only reallocates
 * their funding: the liquid side is credited back, the savings side is
 * reduced. Once the goal is settled, the closing entries already account for
 * it, so the derived usage drops to zero.
 */
export function getGoalUsage(
  holding: SavingsHolding,
  transactions: LedgerTransaction[] = [],
  asOf = localDateKey(),
): GoalUsage {
  const empty: GoalUsage = {
    rawSpendCents: 0,
    coveredCents: 0,
    overageCents: 0,
  }
  if (
    holding.kind !== 'goal' ||
    holding.closedAt ||
    holding.goalStatus !== 'using' ||
    !holding.goalStartedAt ||
    !holding.goalProjectId
  ) {
    return empty
  }

  let rawSpendCents = 0
  for (const transaction of transactions) {
    if (transaction.type !== 'expense') continue
    if (transaction.date < holding.goalStartedAt) continue
    if (transaction.date > asOf) continue
    for (const line of transaction.allocations) {
      if (
        line.targetType === 'project' &&
        line.projectId === holding.goalProjectId
      ) {
        rawSpendCents += allocationDeltaCents(transaction, line)
      }
    }
  }
  rawSpendCents = Math.max(rawSpendCents, 0)
  const availableCents = savingsBalanceThrough(holding, asOf)
  const coveredCents = Math.min(rawSpendCents, availableCents)
  return {
    rawSpendCents,
    coveredCents,
    overageCents: rawSpendCents - coveredCents,
  }
}

/** The part of all goal pots currently spent on linked projects. */
export function goalCoveredCents(
  holdings: SavingsHolding[],
  transactions: LedgerTransaction[] = [],
  asOf = localDateKey(),
): number {
  let total = 0
  for (const holding of holdings) {
    if (!isHoldingActiveAt(holding, asOf)) continue
    total += getGoalUsage(holding, transactions, asOf).coveredCents
  }
  return total
}

/**
 * How much liquid money the savings module has moved out of the ledger by a
 * date. Positive means the ledger balance should be reduced by this amount.
 * Only ledger-funded deposits and withdrawals affect it; external deposits and
 * interest are outside the ledger entirely.
 */
export function savingsLiquidNetCents(
  holdings: SavingsHolding[],
  dateKey = '9999-12-31',
): number {
  let net = 0
  for (const holding of holdings) {
    for (const entry of holding.entries) {
      if (entry.date > dateKey) continue
      if (entry.kind === 'deposit' && entry.source === 'ledger') {
        net += entry.amountCents
      } else if (entry.kind === 'withdraw') {
        net -= entry.amountCents
      }
    }
  }
  return net
}

/** The rows that appear in the transaction list as transfers. */
export function getSavingsTransfers(
  holdings: SavingsHolding[],
): SavingsTransfer[] {
  const rows: SavingsTransfer[] = []
  for (const holding of holdings) {
    for (const entry of holding.entries) {
      if (entry.kind === 'deposit' && entry.source === 'ledger') {
        rows.push({
          id: entry.id,
          holdingId: holding.id,
          holdingName: holding.name,
          direction: 'toSavings',
          amountCents: entry.amountCents,
          date: entry.date,
          ...(entry.accountId ? { accountId: entry.accountId } : {}),
          ...(entry.note ? { note: entry.note } : {}),
        })
      } else if (entry.kind === 'withdraw') {
        rows.push({
          id: entry.id,
          holdingId: holding.id,
          holdingName: holding.name,
          direction: 'fromSavings',
          amountCents: entry.amountCents,
          date: entry.date,
          ...(entry.accountId ? { accountId: entry.accountId } : {}),
          ...(entry.note ? { note: entry.note } : {}),
        })
      }
    }
  }
  return rows.sort(
    (left, right) =>
      right.date.localeCompare(left.date) || right.id.localeCompare(left.id),
  )
}

export interface SavingsTotals {
  balanceCents: number
  principalCents: number
  interestCents: number
  expectedInterestCents: number
  activeCount: number
  maturedCount: number
  dueSoonCount: number
}

export function getSavingsTotals(
  holdings: SavingsHolding[],
  today = localDateKey(),
  transactions: LedgerTransaction[] = [],
): SavingsTotals {
  let balanceCents = 0
  let principalCents = 0
  let interestCents = 0
  let expectedInterestCentsTotal = 0
  let activeCount = 0
  let maturedCount = 0
  let dueSoonCount = 0
  for (const holding of holdings) {
    if (!isHoldingActiveAt(holding, today)) continue
    const summary = getSavingsSummary(holding, today, transactions)
    balanceCents += summary.balanceCents
    principalCents += holding.principalCents
    interestCents += summary.interestCents
    expectedInterestCentsTotal += summary.expectedInterestCents
    activeCount += 1
    if (summary.matured) maturedCount += 1
    else if (
      summary.daysToMaturity !== null &&
      summary.daysToMaturity >= 0 &&
      summary.daysToMaturity <= 3
    ) {
      dueSoonCount += 1
    }
  }
  return {
    balanceCents,
    principalCents,
    interestCents,
    expectedInterestCents: expectedInterestCentsTotal,
    activeCount,
    maturedCount,
    dueSoonCount,
  }
}

export function getInterestThisYear(
  holdings: SavingsHolding[],
  year = localDateKey().slice(0, 4),
): number {
  let total = 0
  for (const holding of holdings) {
    for (const entry of holding.entries) {
      if (entry.kind === 'interest' && entry.date.startsWith(`${year}-`)) {
        total += entry.amountCents
      }
    }
  }
  return total
}

export function getWeightedAnnualRateBps(
  holdings: SavingsHolding[],
): number | null {
  let weighted = 0
  let total = 0
  const today = localDateKey()
  for (const holding of holdings) {
    if (
      holding.closedAt ||
      holding.kind === 'goal' ||
      holding.startDate > today ||
      !holding.annualRateBps
    ) {
      continue
    }
    const balance = savingsBalance(holding)
    if (balance <= 0) continue
    weighted += balance * holding.annualRateBps
    total += balance
  }
  return total > 0 ? Math.round(weighted / total) : null
}

export function sortedSavingsEntries(
  holding: SavingsHolding,
): SavingsEntry[] {
  return [...holding.entries].sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      right.createdAt.localeCompare(left.createdAt),
  )
}

export function sortSavingsHoldings(
  holdings: SavingsHolding[],
  today = localDateKey(),
): SavingsHolding[] {
  const rank = (holding: SavingsHolding): number => {
    if (holding.closedAt) return 3
    const summary = getSavingsSummary(holding, today)
    if (summary.matured) return 0
    if (
      summary.daysToMaturity !== null &&
      summary.daysToMaturity >= 0 &&
      summary.daysToMaturity <= 3
    ) {
      return 1
    }
    return 2
  }
  return [...holdings].sort((left, right) => {
    const leftRank = rank(left)
    const rightRank = rank(right)
    if (leftRank !== rightRank) return leftRank - rightRank
    const leftDate = left.maturityDate ?? '9999-12-31'
    const rightDate = right.maturityDate ?? '9999-12-31'
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate)
    return right.updatedAt.localeCompare(left.updatedAt)
  })
}

export const SAVINGS_KIND_LABELS: Record<SavingsKind, string> = {
  fixed: '定期存款',
  large: '大额存单',
  bond: '国债',
  wealth: '银行理财',
  fund: '货币基金',
  housing: '公积金',
  goal: '目标储蓄',
  other: '其他储蓄',
}

/**
 * Renews a matured term at its maturity date. The old holding keeps its
 * history (and the interest is recorded there), then closes; the new holding
 * starts from the total value and is funded externally, because the money never
 * passed back through the liquid balance.
 */
export function renewSavingsHolding(
  holding: SavingsHolding,
  now = new Date().toISOString(),
): { closed: SavingsHolding; created: SavingsHolding } | null {
  if (holding.kind === 'goal' || holding.closedAt || !holding.maturityDate) {
    return null
  }
  const summary = getSavingsSummary(holding)
  if (!summary.matured) return null
  // If the user already recorded the actual interest, it is inside the
  // balance; adding the estimate again would double count it.
  const hasRecordedInterest = holding.entries.some(
    (entry) => entry.kind === 'interest',
  )
  const interest = hasRecordedInterest ? 0 : summary.expectedInterestCents
  const maturity = holding.maturityDate
  const termDays = Math.max(
    daysBetween(holding.startDate, holding.maturityDate),
    1,
  )
  const newMaturity = addDaysToKey(maturity, termDays)
  const newPrincipal = summary.balanceCents + interest
  if (newPrincipal <= 0) return null
  const closed: SavingsHolding = {
    ...holding,
    entries: [
      ...holding.entries,
      ...(interest > 0
        ? [
            {
              id: newSavingsEntryId(),
              kind: 'interest' as const,
              amountCents: interest,
              date: maturity,
              note: '到期利息（续存）',
              createdAt: now,
            },
          ]
        : []),
    ],
    closedAt: maturity,
    updatedAt: now,
  }
  const created: SavingsHolding = {
    id: newSavingsId(),
    name: holding.name,
    kind: holding.kind,
    ...(holding.institution ? { institution: holding.institution } : {}),
    principalCents: newPrincipal,
    ...(holding.annualRateBps
      ? { annualRateBps: holding.annualRateBps }
      : {}),
    startDate: maturity,
    maturityDate: newMaturity,
    ...(holding.autoRenew ? { autoRenew: true } : {}),
    ...(holding.note ? { note: holding.note } : {}),
    entries: [
      {
        id: newSavingsEntryId(),
        kind: 'deposit',
        amountCents: newPrincipal,
        date: maturity,
        source: 'external' satisfies SavingsSource,
        note: `续存自「${holding.name}」`,
        createdAt: now,
      },
    ],
    renewedFromId: holding.id,
    createdAt: now,
    updatedAt: now,
  }
  return { closed, created }
}

export function sortSavingsGoals(
  holdings: SavingsHolding[],
): SavingsHolding[] {
  const rank = (holding: SavingsHolding): number => {
    if (holding.goalStatus === 'using') return 0
    if (holding.goalStatus === 'settled' || holding.closedAt) return 2
    return 1
  }
  return [...holdings].sort((left, right) => {
    const leftRank = rank(left)
    const rightRank = rank(right)
    if (leftRank !== rightRank) return leftRank - rightRank
    const leftDate = left.goalDate ?? '9999-12-31'
    const rightDate = right.goalDate ?? '9999-12-31'
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate)
    return right.updatedAt.localeCompare(left.updatedAt)
  })
}

/**
 * Closes a goal and writes the funding movements. Project spending already
 * lives in the ledger, so it is covered by a withdrawal back to liquid; the
 * remaining pot returns to liquid too. Without a project, `spentCents` is the
 * amount actually used; `writeToFlow` decides whether that becomes an expense
 * record or an off-ledger balance adjustment.
 */
export function buildGoalSettlement(
  holding: SavingsHolding,
  transactions: LedgerTransaction[] = [],
  options: {
    spentCents?: number
    writeToFlow?: boolean
    date: string
    now: string
  },
): GoalSettlement | null {
  if (holding.kind !== 'goal' || holding.closedAt) return null
  const availableCents = savingsBalanceThrough(holding, options.date)
  const usage = getGoalUsage(holding, transactions, options.date)
  const hasProject = Boolean(holding.goalProjectId)
  const spentCents = hasProject
    ? usage.rawSpendCents
    : Math.max(options.spentCents ?? 0, 0)
  const coveredCents = hasProject
    ? usage.coveredCents
    : Math.min(spentCents, availableCents)
  const remainingCents = Math.max(availableCents - coveredCents, 0)
  const writeToFlow = hasProject || options.writeToFlow !== false

  const entries: SavingsEntry[] = []
  if (coveredCents > 0) {
    entries.push({
      id: newSavingsEntryId(),
      kind: writeToFlow ? 'withdraw' : 'adjust',
      amountCents: writeToFlow ? coveredCents : -coveredCents,
      date: options.date,
      note: writeToFlow
        ? hasProject
          ? '目标结算 · 项目支出'
          : '目标结算 · 目标支出'
        : '目标结算 · 目标支出（未入流水）',
      createdAt: options.now,
    })
  }
  if (remainingCents > 0) {
    entries.push({
      id: newSavingsEntryId(),
      kind: 'withdraw',
      amountCents: remainingCents,
      date: options.date,
      note: '目标结算 · 剩余返还',
      createdAt: options.now,
    })
  }

  const closed: SavingsHolding = {
    ...holding,
    entries: [...holding.entries, ...entries],
    closedAt: options.date,
    goalStatus: 'settled',
    goalSettledAt: options.date,
    updatedAt: options.now,
  }
  return {
    spentCents,
    coveredCents,
    overageCents: Math.max(spentCents - coveredCents, 0),
    remainingCents,
    closed,
  }
}

/** The date a maturity reminder should fire, for the two milestones. */
export function maturityMilestones(holding: SavingsHolding): string[] {
  if (!holding.maturityDate || holding.closedAt) return []
  const soon = addDaysToKey(holding.maturityDate, -3)
  return soon < holding.startDate
    ? [holding.maturityDate]
    : [soon, holding.maturityDate]
}
