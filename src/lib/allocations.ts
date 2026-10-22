import type {
  AllocationBasis,
  AllocationLine,
  LedgerTransaction,
  MonthSpendCents,
  Posting,
  ProjectMonthRow,
  ProjectSummary,
  TransactionScope,
} from '../types'

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `al-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function newAllocationId(): string {
  return makeId()
}

export function makeDailyAllocation(
  amountCents: number,
  id = newAllocationId(),
  basis: AllocationBasis = 'ratio',
): AllocationLine {
  return {
    id,
    targetType: 'daily',
    amountCents,
    weight: 1,
    ratioBp: 10000,
    basis,
  }
}

export function makeProjectAllocation(
  projectId: string,
  amountCents: number,
  id = newAllocationId(),
  basis: AllocationBasis = 'ratio',
): AllocationLine {
  return {
    id,
    targetType: 'project',
    projectId,
    amountCents,
    weight: 1,
    ratioBp: 10000,
    basis,
  }
}

export function sumAllocationCents(allocations: AllocationLine[]): number {
  return allocations.reduce((sum, line) => sum + line.amountCents, 0)
}

export function isBalancedAllocation(
  amountCents: number,
  allocations: AllocationLine[],
): boolean {
  return sumAllocationCents(allocations) === amountCents
}

/**
 * Splits an integer amount by relative weights. Floors every line first,
 * then hands the remaining cents to the largest fractional remainders.
 * Ties go to the larger weight, then to the earlier line.
 */
export function largestRemainder(
  totalCents: number,
  weights: number[],
): number[] {
  if (weights.length === 0) return []
  const safeWeights = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 0,
  )
  const totalWeight = safeWeights.reduce((sum, weight) => sum + weight, 0)
  if (totalWeight <= 0 || totalCents <= 0) {
    return safeWeights.map(() => 0)
  }

  const raw = safeWeights.map((weight) => (totalCents * weight) / totalWeight)
  const result = raw.map((value) => Math.floor(value))
  let remainder = totalCents - result.reduce((sum, value) => sum + value, 0)

  const order = raw
    .map((value, index) => ({
      index,
      fraction: value - Math.floor(value),
      weight: safeWeights[index],
    }))
    .filter((item) => item.weight > 0)
    .sort(
      (a, b) =>
        b.fraction - a.fraction ||
        b.weight - a.weight ||
        a.index - b.index,
    )

  for (let i = 0; i < order.length && remainder > 0; i += 1) {
    result[order[i].index] += 1
    remainder -= 1
  }

  return result
}

/**
 * Keeps the existing targets and weights while changing the gross amount.
 * Used when an old transaction is edited before the split editor ships.
 */
export function scaleAllocations(
  allocations: AllocationLine[],
  newTotalCents: number,
): AllocationLine[] {
  if (allocations.length === 0) {
    return [makeDailyAllocation(newTotalCents)]
  }
  if (newTotalCents <= 0) return []

  const weights = allocations.map((line) => line.amountCents)
  const amounts =
    allocations.length === 1
      ? [newTotalCents]
      : largestRemainder(newTotalCents, weights)

  return allocations
    .map((line, index) => ({
      ...line,
      amountCents: amounts[index] ?? 0,
      ratioBp:
        newTotalCents > 0
          ? Math.round(((amounts[index] ?? 0) / newTotalCents) * 10000)
          : 0,
    }))
    .filter((line) => line.amountCents > 0)
}

export function getAmountYuan(transaction: LedgerTransaction): number {
  return transaction.amountCents / 100
}

export function getScope(transaction: LedgerTransaction): TransactionScope {
  const hasDaily = transaction.allocations.some(
    (line) => line.targetType === 'daily',
  )
  const projectIds = new Set(
    transaction.allocations
      .filter((line) => line.targetType === 'project' && line.projectId)
      .map((line) => line.projectId as string),
  )

  if (hasDaily && projectIds.size > 0) return 'shared'
  if (projectIds.size > 1) return 'shared'
  return projectIds.size === 1 ? 'project' : 'daily'
}

export function getProjectIds(transaction: LedgerTransaction): string[] {
  return [
    ...new Set(
      transaction.allocations
        .filter((line) => line.targetType === 'project' && line.projectId)
        .map((line) => line.projectId as string),
    ),
  ]
}

export function getProjectAmountCents(
  transaction: LedgerTransaction,
  projectId: string,
): number {
  return transaction.allocations.reduce(
    (sum, line) =>
      line.targetType === 'project' && line.projectId === projectId
        ? sum + line.amountCents
        : sum,
    0,
  )
}

/**
 * Removes a project from every allocation while keeping the gross amount in
 * the ledger. Freed money joins the daily line (or creates one), so deleting a
 * project never makes its transactions disappear from daily totals.
 */
export function detachProjectAllocations(
  allocations: AllocationLine[],
  projectId: string,
): AllocationLine[] {
  let movedCents = 0
  const remaining: AllocationLine[] = []

  for (const line of allocations) {
    if (line.targetType === 'project' && line.projectId === projectId) {
      movedCents += line.amountCents
    } else {
      remaining.push(line)
    }
  }

  if (movedCents === 0) return allocations

  const dailyIndex = remaining.findIndex(
    (line) => line.targetType === 'daily',
  )
  if (dailyIndex >= 0) {
    remaining[dailyIndex] = {
      ...remaining[dailyIndex],
      amountCents: remaining[dailyIndex].amountCents + movedCents,
    }
  } else {
    remaining.unshift(
      makeDailyAllocation(movedCents, undefined, 'migrated'),
    )
  }

  const totalCents = sumAllocationCents(remaining)
  return remaining.map((line) => ({
    ...line,
    ratioBp:
      totalCents > 0
        ? Math.round((line.amountCents / totalCents) * 10000)
        : 0,
  }))
}

export function toPostings(
  transactions: LedgerTransaction[],
): Posting[] {
  return transactions.flatMap((transaction) =>
    transaction.allocations.map((line) => ({
      month: transaction.date.slice(0, 7),
      date: transaction.date,
      transactionId: transaction.id,
      allocationId: line.id,
      kind: transaction.type,
      targetType: line.targetType,
      projectId: line.projectId,
      categoryId: transaction.categoryId,
      signedCents: line.amountCents,
    })),
  )
}

export function getMonthSpendCents(
  transactions: LedgerTransaction[],
  monthKey: string,
): MonthSpendCents {
  let dailyCents = 0
  let projectCents = 0

  for (const posting of toPostings(transactions)) {
    if (posting.month !== monthKey || posting.kind !== 'expense') continue
    if (posting.targetType === 'daily') dailyCents += posting.signedCents
    else projectCents += posting.signedCents
  }

  return {
    dailyCents,
    projectCents,
    totalCents: dailyCents + projectCents,
  }
}

export function getProjectSummary(
  transactions: LedgerTransaction[],
  projectId: string,
): ProjectSummary {
  const byMonth = new Map<string, { expense: number; income: number }>()
  let totalExpenseCents = 0
  let totalIncomeCents = 0

  for (const posting of toPostings(transactions)) {
    if (posting.projectId !== projectId) continue
    const bucket = byMonth.get(posting.month) ?? { expense: 0, income: 0 }
    if (posting.kind === 'expense') {
      totalExpenseCents += posting.signedCents
      bucket.expense += posting.signedCents
    } else {
      totalIncomeCents += posting.signedCents
      bucket.income += posting.signedCents
    }
    byMonth.set(posting.month, bucket)
  }

  let cumulativeExpenseCents = 0
  const months = [...byMonth.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([month, value]) => {
      cumulativeExpenseCents += value.expense
      return {
        month,
        expenseCents: value.expense,
        cumulativeExpenseCents,
      }
    })

  return {
    projectId,
    totalExpenseCents,
    totalIncomeCents,
    netCents: totalIncomeCents - totalExpenseCents,
    byMonth: months,
  }
}

export function getProjectMonthRows(
  transactions: LedgerTransaction[],
  monthKey: string,
): ProjectMonthRow[] {
  const rows = new Map<string, ProjectMonthRow>()

  for (const posting of toPostings(transactions)) {
    if (!posting.projectId || posting.month > monthKey) continue
    const row = rows.get(posting.projectId) ?? {
      projectId: posting.projectId,
      monthExpenseCents: 0,
      monthIncomeCents: 0,
      cumulativeExpenseCents: 0,
      cumulativeIncomeCents: 0,
    }

    if (posting.kind === 'expense') {
      row.cumulativeExpenseCents += posting.signedCents
      if (posting.month === monthKey) {
        row.monthExpenseCents += posting.signedCents
      }
    } else {
      row.cumulativeIncomeCents += posting.signedCents
      if (posting.month === monthKey) {
        row.monthIncomeCents += posting.signedCents
      }
    }

    rows.set(posting.projectId, row)
  }

  return [...rows.values()].sort(
    (left, right) => right.monthExpenseCents - left.monthExpenseCents,
  )
}

export function getDailyCategoryCents(
  transactions: LedgerTransaction[],
  monthKey: string,
): Map<string, number> {
  const totals = new Map<string, number>()

  for (const posting of toPostings(transactions)) {
    if (
      posting.month !== monthKey ||
      posting.kind !== 'expense' ||
      posting.targetType !== 'daily'
    ) {
      continue
    }
    totals.set(
      posting.categoryId,
      (totals.get(posting.categoryId) ?? 0) + posting.signedCents,
    )
  }

  return totals
}

/**
 * Category totals for one project. A project itself has no category: every
 * expense keeps the category chosen on its transaction, and the project view
 * simply rolls those categories up.
 */
export function getProjectCategoryCents(
  transactions: LedgerTransaction[],
  projectId: string,
): Map<string, number> {
  const totals = new Map<string, number>()

  for (const posting of toPostings(transactions)) {
    if (posting.projectId !== projectId || posting.kind !== 'expense') continue
    totals.set(
      posting.categoryId,
      (totals.get(posting.categoryId) ?? 0) + posting.signedCents,
    )
  }

  return totals
}
