import type {
  Account,
  AllocationLine,
  Category,
  LedgerTransaction,
  Project,
  SpendingNature,
  TransactionType,
} from '../types'
import { isCurrency } from './currency'
import { makeDailyAllocation, sumAllocationCents } from './allocations'
import { getActiveCategories } from './categories'

export const ACCOUNTS: Account[] = [
  { id: 'wechat', name: '微信' },
  { id: 'alipay', name: '支付宝' },
  { id: 'bank', name: '银行卡' },
  { id: 'cash', name: '现金' },
]

export { getCategoriesForType, getCategory } from './categories'

export function getAccount(id: string): Account {
  return ACCOUNTS.find((account) => account.id === id) ?? ACCOUNTS[2]
}

type SeedRow = [
  day: number,
  categoryId: string,
  accountId: string,
  amount: number,
  note: string,
]

const EXPENSE_SEED: SeedRow[] = [
  [1, 'housing', 'bank', 4500, '房租 · 这个月的家'],
  [2, 'food', 'wechat', 68, '早餐和一杯拿铁'],
  [4, 'transport', 'alipay', 12, '地铁通勤'],
  [5, 'shopping', 'wechat', 236, '日用补货'],
  [7, 'food', 'alipay', 48, '一人食午餐'],
  [8, 'entertainment', 'wechat', 128, '周末电影'],
  [9, 'transport', 'alipay', 6, '公交'],
  [10, 'food', 'wechat', 35, '深夜食堂'],
  [11, 'medical', 'bank', 108, '常用药'],
  [12, 'education', 'alipay', 199, '线上课程'],
  [13, 'food', 'wechat', 56, '水果和酸奶'],
  [15, 'shopping', 'alipay', 328, '换季衣物'],
  [16, 'transport', 'wechat', 24, '打车回家'],
  [17, 'food', 'alipay', 72, '朋友聚餐'],
  [18, 'entertainment', 'wechat', 88, '街角咖啡馆'],
  [19, 'food', 'wechat', 46, '早餐'],
  [20, 'shopping', 'wechat', 159, '家居小物'],
  [22, 'food', 'alipay', 63, '晚餐'],
  [23, 'transport', 'wechat', 18, '地铁'],
  [24, 'medical', 'alipay', 56, '维生素'],
  [25, 'food', 'wechat', 92, '周末早午餐'],
  [26, 'entertainment', 'alipay', 168, '展览门票'],
  [27, 'shopping', 'wechat', 203, '书和文具'],
  [28, 'food', 'alipay', 51, '晚餐'],
  [29, 'transport', 'wechat', 14, '地铁'],
  [30, 'food', 'wechat', 114, '朋友来家里吃饭'],
]

const INCOME_SEED: SeedRow[] = [
  [10, 'salary', 'bank', 15200, '月度工资'],
  [18, 'freelance', 'alipay', 1200, '设计稿尾款'],
  [25, 'investment', 'bank', 268, '基金分红'],
  [23, 'gift', 'wechat', 520, '家人的红包'],
]

const EXTRA_SEED: Record<number, SeedRow[]> = {
  [-5]: [[14, 'shopping', 'alipay', 1280, '换了一副耳机']],
  [-4]: [[21, 'entertainment', 'wechat', 1680, '音乐节门票和住宿']],
  [-3]: [[7, 'education', 'alipay', 920, '暑期课程']],
  [-2]: [
    [14, 'medical', 'bank', 860, '年度体检'],
    [22, 'shopping', 'alipay', 1460, '短途旅行'],
  ],
  [-1]: [
    [16, 'shopping', 'wechat', 1580, '秋天的外套'],
    [26, 'entertainment', 'wechat', 480, '现场演出'],
  ],
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `txn-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function makeSeedTransaction(
  id: string,
  type: TransactionType,
  amount: number,
  categoryId: string,
  accountId: string,
  date: string,
  note: string,
  createdAt: string,
  spendingNature?: SpendingNature,
): LedgerTransaction {
  const amountCents = Math.round(amount * 100)
  return {
    id,
    schemaVersion: 2,
    type,
    amountCents,
    categoryId,
    accountId,
    date,
    note,
    ...(spendingNature ? { spendingNature } : {}),
    allocations: [makeDailyAllocation(amountCents, `${id}-al-1`)],
    createdAt,
  }
}

/** Demo data mirrors how a real ledger would be marked. */
const ESSENTIAL_SEED_CATEGORIES = new Set([
  'food',
  'housing',
  'transport',
  'medical',
  'education',
])

/**
 * Seeds six months of quietly realistic data, relative to the day the ledger
 * is first opened. Amounts vary a little month to month so the charts feel lived in.
 */
export function createSeedTransactions(now = new Date()): LedgerTransaction[] {
  const transactions: LedgerTransaction[] = []

  for (let offset = -5; offset <= 0; offset += 1) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    const year = monthDate.getFullYear()
    const month = monthDate.getMonth()
    const lastDay =
      offset === 0 ? now.getDate() : daysInMonth(year, month)
    const variant = ((year * 12 + month) % 5) / 100
    const monthKey = `${year}-${pad(month + 1)}`

    EXPENSE_SEED.forEach(([day, categoryId, accountId, amount, note], index) => {
      if (day > lastDay) return
      const isFixed = categoryId === 'housing'
      const adjusted = isFixed
        ? amount
        : Math.round(amount * (1 + variant) + ((index * 7) % 9) - 4)
      transactions.push(
        makeSeedTransaction(
          `seed-${monthKey}-e-${index}`,
          'expense',
          adjusted,
          categoryId,
          accountId,
          dateKey(year, month, day),
          note,
          new Date(
            year,
            month,
            day,
            9 + (index % 10),
            index % 60,
          ).toISOString(),
          ESSENTIAL_SEED_CATEGORIES.has(categoryId)
            ? 'essential'
            : 'flexible',
        ),
      )
    })

    ;(EXTRA_SEED[offset] ?? []).forEach(
      ([day, categoryId, accountId, amount, note], index) => {
        if (day > lastDay) return
        transactions.push(
          makeSeedTransaction(
            `seed-${monthKey}-x-${index}`,
            'expense',
            amount,
            categoryId,
            accountId,
            dateKey(year, month, day),
            note,
            new Date(
              year,
              month,
              day,
              15 + (index % 5),
              20 + index,
            ).toISOString(),
            ESSENTIAL_SEED_CATEGORIES.has(categoryId)
              ? 'essential'
              : 'flexible',
          ),
        )
      },
    )

    INCOME_SEED.forEach(([day, categoryId, accountId, baseAmount, note], index) => {
      if (day > lastDay) return
      if (categoryId === 'gift' && offset % 2 !== 0) return
      if (categoryId === 'investment' && offset === 0 && now.getDate() < 25) return
      const amount =
        categoryId === 'salary'
          ? baseAmount + (offset % 3 === 0 ? 400 : offset % 3 === 1 ? 0 : 800)
          : baseAmount
      transactions.push(
        makeSeedTransaction(
          `seed-${monthKey}-i-${index}`,
          'income',
          amount,
          categoryId,
          accountId,
          dateKey(year, month, day),
          note,
          new Date(
            year,
            month,
            day,
            8 + index,
            10 + index,
          ).toISOString(),
        ),
      )
    })
  }

  return sortTransactions(transactions)
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
    typeof item.accountId === 'string' &&
    ACCOUNTS.some((account) => account.id === item.accountId) &&
    typeof item.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
    typeof item.note === 'string' &&
    (item.spendingNature === undefined ||
      item.spendingNature === 'essential' ||
      item.spendingNature === 'flexible') &&
    typeof item.createdAt === 'string' &&
    (item.updatedAt === undefined || typeof item.updatedAt === 'string')
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

  const accountId = typeof item.accountId === 'string' ? item.accountId : ''
  if (!ACCOUNTS.some((account) => account.id === accountId)) return null

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
    isCurrency(item.currency) &&
    (item.owner === undefined || typeof item.owner === 'string') &&
    (item.note === undefined || typeof item.note === 'string') &&
    (item.archivedAt === undefined ||
      typeof item.archivedAt === 'string') &&
    typeof item.createdAt === 'string' &&
    typeof item.updatedAt === 'string'
  )
}
