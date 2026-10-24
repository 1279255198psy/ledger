import type {
  AllocationLine,
  Category,
  LedgerTransaction,
  Project,
} from '../types'
import { isCurrency } from './currency'
import { makeDailyAllocation, sumAllocationCents } from './allocations'
import { getActiveCategories } from './categories'

export { getCategoriesForType, getCategory } from './categories'

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `txn-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function newTransactionId(): string {
  return makeId()
}

export function newProjectId(): string {
  return `project-${makeId()}`
}

export function sortTransactions(
  transactions: LedgerTransaction[],
): LedgerTransaction[] {
  return [...transactions].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date)
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export function isValidAllocation(value: unknown): value is AllocationLine {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<AllocationLine>
  const isProject = item.targetType === 'project'

  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    (item.targetType === 'daily' || item.targetType === 'project') &&
    (isProject
      ? typeof item.projectId === 'string' && item.projectId.length > 0
      : item.projectId === undefined) &&
    typeof item.amountCents === 'number' &&
    Number.isInteger(item.amountCents) &&
    item.amountCents > 0 &&
    (item.weight === undefined ||
      (typeof item.weight === 'number' &&
        Number.isFinite(item.weight) &&
        item.weight > 0)) &&
    (item.ratioBp === undefined ||
      (typeof item.ratioBp === 'number' &&
        Number.isInteger(item.ratioBp) &&
        item.ratioBp >= 0)) &&
    (item.basis === 'ratio' ||
      item.basis === 'headcount' ||
      item.basis === 'fixed' ||
      item.basis === 'migrated') &&
    (item.note === undefined || typeof item.note === 'string')
  )
}

export function isValidTransaction(
  value: unknown,
  categories: Category[] = getActiveCategories(),
): value is LedgerTransaction {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LedgerTransaction>
  if (
    typeof item.id !== 'string' ||
    item.id.length === 0 ||
    item.schemaVersion !== 2 ||
    (item.type !== 'expense' && item.type !== 'income') ||
    typeof item.amountCents !== 'number' ||
    !Number.isInteger(item.amountCents) ||
    item.amountCents <= 0 ||
    !Array.isArray(item.allocations) ||
    item.allocations.length === 0 ||
    !item.allocations.every(isValidAllocation)
  ) {
    return false
  }
  if (sumAllocationCents(item.allocations) !== item.amountCents) return false

  return (
    typeof item.categoryId === 'string' &&
    categories.some(
      (category) =>
        category.id === item.categoryId && category.type === item.type,
    ) &&
    // Accounts are user-managed, so an id that is no longer in the current
    // list still has to survive as history rather than dropping the entry.
    typeof item.accountId === 'string' &&
    item.accountId.length > 0 &&
    item.accountId.length <= 80 &&
    typeof item.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
    typeof item.note === 'string' &&
    (item.spendingNature === undefined ||
      item.spendingNature === 'essential' ||
      item.spendingNature === 'flexible') &&
    typeof item.createdAt === 'string' &&
    (item.updatedAt === undefined || typeof item.updatedAt === 'string') &&
    // Only a payment can be refunded, so the flag never rides on income.
    (item.kind === undefined ||
      (item.kind === 'refund' && item.type === 'expense'))
  )
}

export function migrateV1Transaction(
  value: unknown,
  categories: Category[] = getActiveCategories(),
): LedgerTransaction | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const type =
    item.type === 'income'
      ? 'income'
      : item.type === 'expense'
        ? 'expense'
        : null
  if (!type) return null

  const amount =
    typeof item.amount === 'number'
      ? item.amount
      : typeof item.amount === 'string'
        ? Number(item.amount)
        : NaN
  if (!Number.isFinite(amount) || amount <= 0) return null
  const amountCents = Math.round(amount * 100)
  if (!Number.isInteger(amountCents) || amountCents <= 0) return null

  const categoryId =
    typeof item.categoryId === 'string' ? item.categoryId : ''
  if (
    !categories.some(
      (category) => category.id === categoryId && category.type === type,
    )
  ) {
    return null
  }

  const accountId =
    typeof item.accountId === 'string' && item.accountId.length > 0
      ? item.accountId
      : 'bank'
  if (accountId.length > 80) return null

  const date = typeof item.date === 'string' ? item.date : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

  const id =
    typeof item.id === 'string' && item.id.length > 0 ? item.id : makeId()

  return {
    id,
    schemaVersion: 2,
    type,
    amountCents,
    categoryId,
    accountId,
    date,
    note: typeof item.note === 'string' ? item.note : '',
    allocations: [makeDailyAllocation(amountCents, `${id}-al-1`, 'migrated')],
    createdAt:
      typeof item.createdAt === 'string'
        ? item.createdAt
        : new Date().toISOString(),
    ...(typeof item.updatedAt === 'string'
      ? { updatedAt: item.updatedAt }
      : {}),
  }
}

/**
 * Accepts a valid v2 transaction or migrates one from the v1 shape. Anything
 * that already claims to be v2 is never silently downgraded to a daily split.
 */
export function normalizeTransaction(
  value: unknown,
  categories: Category[] = getActiveCategories(),
): LedgerTransaction | null {
  if (isValidTransaction(value, categories)) return value
  if (value && typeof value === 'object') {
    const item = value as Record<string, unknown>
    if (
      item.schemaVersion !== undefined ||
      item.amountCents !== undefined ||
      item.allocations !== undefined
    ) {
      return null
    }
  }
  return migrateV1Transaction(value, categories)
}

export function isValidProject(
  value: unknown,
  categories: Category[] = getActiveCategories(),
): value is Project {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<Project>
  const datePattern = /^\d{4}-\d{2}-\d{2}$/
  const categoryBudgets = item.categoryBudgetsCents
  const categoryBudgetsValid =
    categoryBudgets === undefined ||
    (categoryBudgets !== null &&
      typeof categoryBudgets === 'object' &&
      !Array.isArray(categoryBudgets) &&
      Object.entries(categoryBudgets).every(
        ([categoryId, cents]) =>
          categories.some(
            (category) =>
              category.id === categoryId && category.type === 'expense',
          ) &&
          typeof cents === 'number' &&
          Number.isInteger(cents) &&
          cents >= 0,
      ))

  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.name === 'string' &&
    item.name.trim().length > 0 &&
    (item.code === undefined || typeof item.code === 'string') &&
    (item.status === 'active' || item.status === 'closed') &&
    typeof item.startDate === 'string' &&
    datePattern.test(item.startDate) &&
    (item.endDate === undefined ||
      (typeof item.endDate === 'string' && datePattern.test(item.endDate))) &&
    (item.budgetCents === undefined ||
      (typeof item.budgetCents === 'number' &&
        Number.isInteger(item.budgetCents) &&
        item.budgetCents >= 0)) &&
    categoryBudgetsValid &&
    (item.countsInDaily === undefined ||
      typeof item.countsInDaily === 'boolean') &&
    isCurrency(item.currency) &&
    (item.owner === undefined || typeof item.owner === 'string') &&
    (item.note === undefined || typeof item.note === 'string') &&
    (item.archivedAt === undefined ||
      typeof item.archivedAt === 'string') &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  )
}
