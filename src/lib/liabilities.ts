import type {
  Liability,
  LiabilityRepayment,
  LiabilitySummary,
} from '../types'

function makeId(prefix: string): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function newLiabilityId(): string {
  return makeId('debt')
}

export function newRepaymentId(): string {
  return makeId('repay')
}

function isValidDateKey(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

export function isValidRepayment(value: unknown): value is LiabilityRepayment {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LiabilityRepayment>
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    item.id.length <= 80 &&
    Number.isInteger(item.amountCents) &&
    Number(item.amountCents) > 0 &&
    isValidDateKey(item.date) &&
    typeof item.createdAt === 'string' &&
    (item.note === undefined ||
      (typeof item.note === 'string' && item.note.length <= 200))
  )
}

export function isValidLiability(value: unknown): value is Liability {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<Liability>
  if (
    typeof item.id !== 'string' ||
    item.id.length === 0 ||
    item.id.length > 80 ||
    typeof item.name !== 'string' ||
    item.name.trim().length === 0 ||
    item.name.trim().length > 40 ||
    !Number.isInteger(item.principalCents) ||
    Number(item.principalCents) <= 0 ||
    !Array.isArray(item.repayments) ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return false
  }
  if (
    item.dueDate !== undefined &&
    !isValidDateKey(item.dueDate)
  ) {
    return false
  }
  if (
    item.note !== undefined &&
    (typeof item.note !== 'string' || item.note.length > 200)
  ) {
    return false
  }
  if (!item.repayments.every(isValidRepayment)) return false
  const ids = new Set(item.repayments.map((repayment) => repayment.id))
  return ids.size === item.repayments.length
}

export function sortLiabilities(liabilities: Liability[]): Liability[] {
  return [...liabilities].sort((left, right) => {
    const leftSettled = getLiabilitySummary(left).settled
    const rightSettled = getLiabilitySummary(right).settled
    if (leftSettled !== rightSettled) return leftSettled ? 1 : -1
    if (left.dueDate && right.dueDate && left.dueDate !== right.dueDate) {
      return left.dueDate.localeCompare(right.dueDate)
    }
    if (left.dueDate && !right.dueDate) return -1
    if (!left.dueDate && right.dueDate) return 1
    return right.updatedAt.localeCompare(left.updatedAt)
  })
}

function todayKey(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

export function getLiabilitySummary(
  liability: Liability,
): LiabilitySummary {
  const repaidCents = liability.repayments.reduce(
    (total, repayment) => total + repayment.amountCents,
    0,
  )
  const remainingCents = Math.max(
    liability.principalCents - repaidCents,
    0,
  )
  return {
    repaidCents,
    remainingCents,
    settled: remainingCents === 0,
    overdue:
      remainingCents > 0 &&
      Boolean(liability.dueDate && liability.dueDate < todayKey()),
  }
}

export interface LiabilityTotals {
  principalCents: number
  repaidCents: number
  remainingCents: number
  activeCount: number
}

export function getLiabilityTotals(
  liabilities: Liability[],
): LiabilityTotals {
  let principalCents = 0
  let repaidCents = 0
  let remainingCents = 0
  let activeCount = 0
  for (const liability of liabilities) {
    const summary = getLiabilitySummary(liability)
    principalCents += liability.principalCents
    repaidCents += summary.repaidCents
    remainingCents += summary.remainingCents
    if (!summary.settled) activeCount += 1
  }
  return { principalCents, repaidCents, remainingCents, activeCount }
}

export function sortedRepayments(
  liability: Liability,
): LiabilityRepayment[] {
  return [...liability.repayments].sort((left, right) =>
    right.date.localeCompare(left.date),
  )
}
