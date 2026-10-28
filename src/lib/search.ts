import { getProjectIds } from './allocations'
import { getCategory } from './categories'
import type {
  Account,
  Category,
  LedgerTransaction,
  Project,
  TransactionType,
} from '../types'

export type TransactionTypeFilter = 'all' | TransactionType

export interface TransactionFilters {
  query: string
  type: TransactionTypeFilter
  categoryId: string
  accountId: string
  /** YYYY-MM-DD, inclusive. Empty means unbounded. */
  startDate: string
  endDate: string
}

/** Short names people commonly type when they mean a bank. */
const BANK_ALIASES: Record<string, string> = {
  工商银行: '工行',
  建设银行: '建行',
  农业银行: '农行',
  中国银行: '中行',
  交通银行: '交行',
  邮储银行: '邮储',
  招商银行: '招行',
  中信银行: '中信',
  浦发银行: '浦发',
  民生银行: '民生',
  兴业银行: '兴业',
  光大银行: '光大',
  平安银行: '平安',
  华夏银行: '华夏',
  广发银行: '广发',
  北京银行: '北行',
  上海银行: '上行',
  农商银行: '农商',
}

function compact(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, '')
}

function accountAliases(account: Account): string {
  return [
    BANK_ALIASES[account.name],
    account.bank ? BANK_ALIASES[account.bank] : undefined,
  ]
    .filter(Boolean)
    .join(' ')
}

/**
 * Amounts are searched by value, not by substring: "35.99" matches 35.99 and
 * "3599" matches 3599.00, while "35.99" never matches 135.99.
 */
function matchesAmount(amountCents: number, query: string): boolean {
  const plain = query.replace(/[¥￥,，]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(plain)) return false
  const yuan = Number(plain)
  return Number.isFinite(yuan) && Math.round(yuan * 100) === amountCents
}

function matchesQuery(
  item: LedgerTransaction,
  query: string,
  categories: Category[],
  accounts: Account[],
  projects: Project[],
): boolean {
  const needle = compact(query)
  if (!needle) return true

  const category =
    categories.find((entry) => entry.id === item.categoryId) ??
    getCategory(item.categoryId, item.type)
  const parent = category.parentId
    ? categories.find((entry) => entry.id === category.parentId)
    : undefined
  const account = accounts.find((entry) => entry.id === item.accountId)
  const projectNames = getProjectIds(item)
    .map((id) => projects.find((project) => project.id === id)?.name)
    .filter((name): name is string => Boolean(name))
  const allocationNotes = item.allocations
    .map((line) => line.note)
    .filter((note): note is string => Boolean(note))

  const haystack = compact(
    [
      item.note,
      category.name,
      parent?.name ?? '',
      account?.name ?? '',
      account?.bank ?? '',
      account ? accountAliases(account) : '',
      ...projectNames,
      ...allocationNotes,
    ].join(' '),
  )

  if (haystack.includes(needle)) return true
  return matchesAmount(item.amountCents, needle)
}

export function filterTransactions(
  transactions: LedgerTransaction[],
  filters: TransactionFilters,
  categories: Category[],
  accounts: Account[],
  projects: Project[],
): LedgerTransaction[] {
  const normalizedQuery = filters.query.trim()
  const selectedCategory = filters.categoryId
    ? categories.find((category) => category.id === filters.categoryId)
    : undefined

  return transactions.filter((item) => {
    if (filters.type !== 'all' && item.type !== filters.type) return false

    if (filters.categoryId) {
      const itemCategory = categories.find(
        (category) => category.id === item.categoryId,
      )
      // Picking a big category includes everything filed under it.
      const matchesParent =
        selectedCategory !== undefined &&
        !selectedCategory.parentId &&
        itemCategory?.parentId === selectedCategory.id
      if (item.categoryId !== filters.categoryId && !matchesParent) {
        return false
      }
    }

    if (filters.accountId && item.accountId !== filters.accountId) return false
    if (filters.startDate && item.date < filters.startDate) return false
    if (filters.endDate && item.date > filters.endDate) return false

    if (
      normalizedQuery &&
      !matchesQuery(item, normalizedQuery, categories, accounts, projects)
    ) {
      return false
    }

    return true
  })
}

/** True once the user leaves the month view for a wider search scope. */
export function hasGlobalScope(
  filters: Pick<TransactionFilters, 'query' | 'startDate' | 'endDate'>,
): boolean {
  return (
    filters.query.trim() !== '' ||
    filters.startDate !== '' ||
    filters.endDate !== ''
  )
}

export function hasActiveFilters(filters: TransactionFilters): boolean {
  return (
    hasGlobalScope(filters) ||
    filters.type !== 'all' ||
    filters.categoryId !== '' ||
    filters.accountId !== ''
  )
}
