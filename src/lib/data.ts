import type {
  Account,
  Category,
  LedgerTransaction,
  TransactionType,
} from '../types'

export const EXPENSE_CATEGORIES: Category[] = [
  { id: 'food', name: '餐饮', type: 'expense' },
  { id: 'transport', name: '交通', type: 'expense' },
  { id: 'shopping', name: '购物', type: 'expense' },
  { id: 'housing', name: '居住', type: 'expense' },
  { id: 'entertainment', name: '娱乐', type: 'expense' },
  { id: 'medical', name: '医疗', type: 'expense' },
  { id: 'education', name: '教育', type: 'expense' },
  { id: 'other_expense', name: '其他', type: 'expense' },
]

export const INCOME_CATEGORIES: Category[] = [
  { id: 'salary', name: '工资', type: 'income' },
  { id: 'bonus', name: '奖金', type: 'income' },
  { id: 'investment', name: '理财', type: 'income' },
  { id: 'freelance', name: '兼职', type: 'income' },
  { id: 'gift', name: '红包', type: 'income' },
  { id: 'other_income', name: '其他', type: 'income' },
]

export const CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]

export const ACCOUNTS: Account[] = [
  { id: 'wechat', name: '微信' },
  { id: 'alipay', name: '支付宝' },
  { id: 'bank', name: '银行卡' },
  { id: 'cash', name: '现金' },
]

export const CATEGORY_TONES: Record<string, string> = {
  food: 'clay',
  transport: 'sky',
  shopping: 'plum',
  housing: 'olive',
  entertainment: 'amber',
  medical: 'rose',
  education: 'indigo',
  other_expense: 'stone',
  salary: 'forest',
  bonus: 'gold',
  investment: 'teal',
  freelance: 'sky',
  gift: 'rose',
  other_income: 'stone',
}

export function getCategoriesForType(type: TransactionType): Category[] {
  return type === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES
}

export function getCategory(id: string): Category {
  return (
    CATEGORIES.find((category) => category.id === id) ??
    CATEGORIES.find((category) => category.id === 'other_expense')!
  )
}

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
      transactions.push({
        id: `seed-${monthKey}-e-${index}`,
        type: 'expense',
        amount: adjusted,
        categoryId,
        accountId,
        date: dateKey(year, month, day),
        note,
        createdAt: new Date(year, month, day, 9 + (index % 10), index % 60).toISOString(),
      })
    })

    ;(EXTRA_SEED[offset] ?? []).forEach(
      ([day, categoryId, accountId, amount, note], index) => {
        if (day > lastDay) return
        transactions.push({
          id: `seed-${monthKey}-x-${index}`,
          type: 'expense',
          amount,
          categoryId,
          accountId,
          date: dateKey(year, month, day),
          note,
          createdAt: new Date(
            year,
            month,
            day,
            15 + (index % 5),
            20 + index,
          ).toISOString(),
        })
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
      transactions.push({
        id: `seed-${monthKey}-i-${index}`,
        type: 'income',
        amount,
        categoryId,
        accountId,
        date: dateKey(year, month, day),
        note,
        createdAt: new Date(year, month, day, 8 + index, 10 + index).toISOString(),
      })
    })
  }

  return sortTransactions(transactions)
}

export function newTransactionId(): string {
  return makeId()
}

export function sortTransactions(
  transactions: LedgerTransaction[],
): LedgerTransaction[] {
  return [...transactions].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date)
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export function isValidTransaction(value: unknown): value is LedgerTransaction {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<LedgerTransaction>
  return (
    typeof item.id === 'string' &&
    (item.type === 'expense' || item.type === 'income') &&
    typeof item.amount === 'number' &&
    Number.isFinite(item.amount) &&
    item.amount > 0 &&
    typeof item.categoryId === 'string' &&
    getCategoriesForType(item.type).some(
      (category) => category.id === item.categoryId,
    ) &&
    typeof item.accountId === 'string' &&
    ACCOUNTS.some((account) => account.id === item.accountId) &&
    typeof item.date === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(item.date) &&
    typeof item.note === 'string' &&
    typeof item.createdAt === 'string'
  )
}
