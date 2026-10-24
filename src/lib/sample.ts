import type {
  Account,
  BudgetBook,
  LedgerTransaction,
  Liability,
  Project,
  RangeBudget,
} from '../types'
import {
  makeDailyAllocation,
  makeProjectAllocation,
} from './allocations'
import { sortTransactions } from './data'

/**
 * The demo ledger deliberately touches every recent feature: subcategories,
 * essential/flexible spending, several bank cards, two kinds of project
 * accounting, monthly and date-range budgets, opening funds and liabilities.
 */
export const SAMPLE_ACCOUNTS: Account[] = [
  { id: 'wechat', name: '微信', type: 'wechat' },
  { id: 'alipay', name: '支付宝', type: 'alipay' },
  { id: 'bank', name: '招商银行', type: 'bank', bank: '招商银行' },
  {
    id: 'bank-credit',
    name: '招行信用卡',
    type: 'bank',
    bank: '招商银行',
  },
  { id: 'bank-icbc', name: '工商银行', type: 'bank', bank: '工商银行' },
  { id: 'cash', name: '现金', type: 'cash' },
]

export interface SampleLedger {
  accounts: Account[]
  transactions: LedgerTransaction[]
  projects: Project[]
  liabilities: Liability[]
  budgets: BudgetBook
  budgetRanges: RangeBudget[]
  openingBalanceCents: number
}

type SeedRow = [
  day: number,
  categoryId: string,
  accountId: string,
  amount: number,
  note: string,
]

/** Everyday spending. Amounts are in yuan. */
const EXPENSE_SEED: SeedRow[] = [
  [1, 'housing-rent', 'bank', 4500, '房租 · 这个月的家'],
  [2, 'food-meal', 'wechat', 68, '早餐和一杯拿铁'],
  [3, 'food-drink', 'wechat', 28, '下午的两杯咖啡'],
  [4, 'transport-metro', 'alipay', 12, '地铁通勤'],
  [5, 'shopping-daily', 'bank-icbc', 236, '日用补货'],
  [6, 'food-snack', 'alipay', 34, '水果和酸奶'],
  [7, 'food-meal', 'alipay', 48, '一人食午餐'],
  [8, 'entertainment-movie', 'wechat', 128, '周末电影'],
  [9, 'transport-metro', 'alipay', 6, '公交'],
  [10, 'food-meal', 'wechat', 35, '深夜食堂'],
  [11, 'medical-clinic', 'bank-credit', 108, '常用药'],
  [12, 'education-course', 'alipay', 199, '线上课程'],
  [13, 'food-snack', 'wechat', 56, '水果和酸奶'],
  [14, 'housing-utilities', 'bank', 186, '水电燃气'],
  [15, 'shopping-clothes', 'alipay', 328, '换季衣物'],
  [16, 'transport-taxi', 'wechat', 24, '打车回家'],
  [17, 'food-meal', 'alipay', 72, '朋友聚餐'],
  [18, 'food-drink', 'wechat', 32, '街角咖啡馆'],
  [19, 'food-meal', 'wechat', 46, '早餐'],
  [20, 'shopping-daily', 'wechat', 159, '家居小物'],
  [21, 'entertainment-game', 'alipay', 45, '音乐订阅'],
  [22, 'food-meal', 'alipay', 63, '晚餐'],
  [23, 'transport-metro', 'wechat', 18, '地铁'],
  [24, 'medical-clinic', 'alipay', 56, '维生素'],
  [25, 'food-meal', 'wechat', 92, '周末早午餐'],
  [26, 'entertainment-movie', 'alipay', 168, '展览门票'],
  [27, 'education-books', 'wechat', 203, '书和文具'],
  [28, 'food-meal', 'alipay', 51, '晚餐'],
  [29, 'transport-metro', 'wechat', 14, '地铁'],
  [30, 'food-snack', 'wechat', 114, '朋友来家里吃饭'],
]

const INCOME_SEED: SeedRow[] = [
  [10, 'salary-base', 'bank', 15200, '月度工资'],
  [18, 'freelance-gig', 'alipay', 1200, '设计稿尾款'],
  [25, 'investment-dividend', 'bank', 268, '基金分红'],
  [23, 'gift-cash', 'wechat', 520, '家人的红包'],
]

/** A few larger events, relative to the current month. */
const EXTRA_SEED: Record<number, SeedRow[]> = {
  [-5]: [[14, 'shopping-digital', 'alipay', 1280, '换了一副耳机']],
  [-4]: [
    [21, 'entertainment-travel', 'bank-credit', 1680, '音乐节门票和住宿'],
  ],
  [-3]: [[7, 'education-course', 'alipay', 920, '暑期课程']],
  [-2]: [
    [14, 'medical-checkup', 'bank-credit', 860, '年度体检'],
    [22, 'shopping-clothes', 'alipay', 1460, '短途旅行'],
  ],
  [-1]: [
    [16, 'shopping-clothes', 'wechat', 1580, '秋天的外套'],
    [26, 'entertainment-movie', 'wechat', 480, '现场演出'],
  ],
}

interface ProjectSeedRow {
  day: number
  categoryId: string
  accountId: string
  amount: number
  note: string
  projectId: string
  /** Cents that stay in the daily bucket; the rest belongs to the project. */
  dailyCents?: number
}

const YUNNAN_PROJECT_ID = 'sample-project-yunnan'
const HOME_PROJECT_ID = 'sample-project-home'
const FITNESS_PROJECT_ID = 'sample-project-fitness'

/** Project spending; the yunnan trip is closed, the other two are ongoing. */
const PROJECT_SEED: Record<number, ProjectSeedRow[]> = {
  [-2]: [
    {
      day: 9,
      categoryId: 'transport-fuel',
      accountId: 'bank',
      amount: 1800,
      note: '往返机票',
      projectId: YUNNAN_PROJECT_ID,
    },
    {
      day: 9,
      categoryId: 'entertainment-travel',
      accountId: 'bank-credit',
      amount: 1260,
      note: '洱海边住两晚',
      projectId: YUNNAN_PROJECT_ID,
    },
    {
      day: 11,
      categoryId: 'food-meal',
      accountId: 'cash',
      amount: 186,
      note: '古城晚饭',
      projectId: YUNNAN_PROJECT_ID,
    },
    {
      day: 13,
      categoryId: 'transport-taxi',
      accountId: 'alipay',
      amount: 88,
      note: '环湖包车',
      projectId: YUNNAN_PROJECT_ID,
    },
    {
      day: 16,
      categoryId: 'food-snack',
      accountId: 'cash',
      amount: 62,
      note: '集市小吃',
      projectId: YUNNAN_PROJECT_ID,
    },
    {
      day: 16,
      categoryId: 'shopping-digital',
      accountId: 'bank-icbc',
      amount: 2400,
      note: '新家空气净化器',
      projectId: HOME_PROJECT_ID,
    },
    {
      day: 20,
      categoryId: 'shopping-daily',
      accountId: 'bank',
      amount: 900,
      note: '客厅收纳 · 一半算日常',
      projectId: HOME_PROJECT_ID,
      dailyCents: 30000,
    },
  ],
  [-1]: [
    {
      day: 2,
      categoryId: 'food-meal',
      accountId: 'bank-credit',
      amount: 220,
      note: '返程前的早饭',
      projectId: YUNNAN_PROJECT_ID,
    },
    {
      day: 3,
      categoryId: 'shopping-daily',
      accountId: 'cash',
      amount: 360,
      note: '带回来的伴手礼',
      projectId: YUNNAN_PROJECT_ID,
    },
    {
      day: 10,
      categoryId: 'shopping-daily',
      accountId: 'bank-icbc',
      amount: 1200,
      note: '落地灯和地毯 · 也算日常',
      projectId: HOME_PROJECT_ID,
      dailyCents: 30000,
    },
    {
      day: 20,
      categoryId: 'education-course',
      accountId: 'alipay',
      amount: 1200,
      note: '私教课首期',
      projectId: FITNESS_PROJECT_ID,
    },
  ],
  [-3]: [
    {
      day: 12,
      categoryId: 'shopping-daily',
      accountId: 'bank-icbc',
      amount: 600,
      note: '客厅收纳 · 一半算日常',
      projectId: HOME_PROJECT_ID,
      dailyCents: 30000,
    },
  ],
  [0]: [
    {
      day: 2,
      categoryId: 'medical-checkup',
      accountId: 'bank-credit',
      amount: 600,
      note: '健身房体测',
      projectId: FITNESS_PROJECT_ID,
    },
    {
      day: 5,
      categoryId: 'education-course',
      accountId: 'alipay',
      amount: 1200,
      note: '十节私教课',
      projectId: FITNESS_PROJECT_ID,
    },
    {
      day: 9,
      categoryId: 'shopping-digital',
      accountId: 'wechat',
      amount: 399,
      note: '运动手表',
      projectId: FITNESS_PROJECT_ID,
    },
    {
      day: 3,
      categoryId: 'shopping-daily',
      accountId: 'bank-icbc',
      amount: 400,
      note: '厨房小物 · 也算日常',
      projectId: HOME_PROJECT_ID,
      dailyCents: 10000,
    },
  ],
}

const ESSENTIAL_ROOTS = new Set([
  'food',
  'housing',
  'transport',
  'medical',
  'education',
])

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month + 1)}-${pad(day)}`
}

function monthKey(year: number, month: number): string {
  return `${year}-${pad(month + 1)}`
}

function daysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function shiftKey(key: string, days: number): string {
  const date = dateFromKey(key)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`
}

function todayKey(now: Date): string {
  return dateKey(now.getFullYear(), now.getMonth(), now.getDate())
}

function natureOf(categoryId: string): 'essential' | 'flexible' {
  const root = categoryId.split('-')[0]
  return ESSENTIAL_ROOTS.has(root) ? 'essential' : 'flexible'
}

function dailyAllocations(amountCents: number, id: string) {
  return [makeDailyAllocation(amountCents, `${id}-al-1`)]
}

function projectAllocations(
  amountCents: number,
  projectId: string,
  id: string,
  dailyCents = 0,
) {
  if (dailyCents <= 0 || dailyCents >= amountCents) {
    return [makeProjectAllocation(projectId, amountCents, `${id}-al-1`)]
  }
  return [
    makeDailyAllocation(dailyCents, `${id}-al-1`),
    makeProjectAllocation(
      projectId,
      amountCents - dailyCents,
      `${id}-al-2`,
    ),
  ]
}

function makeTransaction(
  id: string,
  type: 'expense' | 'income',
  amountYuan: number,
  categoryId: string,
  accountId: string,
  date: string,
  note: string,
  createdAt: string,
  allocations: LedgerTransaction['allocations'],
): LedgerTransaction {
  const amountCents = Math.round(amountYuan * 100)
  return {
    id,
    schemaVersion: 2,
    type,
    amountCents,
    categoryId,
    accountId,
    date,
    note,
    ...(type === 'expense' ? { spendingNature: natureOf(categoryId) } : {}),
    allocations,
    createdAt,
  }
}

export function createSampleLedger(now = new Date()): SampleLedger {
  const transactions: LedgerTransaction[] = []
  const months: Array<{ year: number; month: number; offset: number }> = []

  for (let offset = -5; offset <= 0; offset += 1) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() + offset, 1)
    months.push({
      year: monthDate.getFullYear(),
      month: monthDate.getMonth(),
      offset,
    })
  }

  for (const { year, month, offset } of months) {
    const lastDay =
      offset === 0 ? now.getDate() : daysInMonth(year, month)
    const variant = ((year * 12 + month) % 5) / 100
    const key = monthKey(year, month)

    EXPENSE_SEED.forEach(([day, categoryId, accountId, amount, note], index) => {
      if (day > lastDay) return
      const isFixed = categoryId === 'housing-rent'
      const adjusted = isFixed
        ? amount
        : Math.round(amount * (1 + variant) + ((index * 7) % 9) - 4)
      const id = `sample-${key}-e-${index}`
      const amountCents = Math.round(adjusted * 100)
      transactions.push(
        makeTransaction(
          id,
          'expense',
          adjusted,
          categoryId,
          accountId,
          dateKey(year, month, day),
          note,
          new Date(year, month, day, 9 + (index % 10), index % 60).toISOString(),
          dailyAllocations(amountCents, id),
        ),
      )
    })

    ;(EXTRA_SEED[offset] ?? []).forEach(
      ([day, categoryId, accountId, amount, note], index) => {
        if (day > lastDay) return
        const id = `sample-${key}-x-${index}`
        const amountCents = Math.round(amount * 100)
        transactions.push(
          makeTransaction(
            id,
            'expense',
            amount,
            categoryId,
            accountId,
            dateKey(year, month, day),
            note,
            new Date(year, month, day, 15 + (index % 5), 20 + index).toISOString(),
            dailyAllocations(amountCents, id),
          ),
        )
      },
    )

    ;(PROJECT_SEED[offset] ?? []).forEach(
      (
        {
          day,
          categoryId,
          accountId,
          amount,
          note,
          projectId,
          dailyCents,
        },
        index,
      ) => {
        if (day > lastDay) return
        const id = `sample-${key}-p-${index}`
        const amountCents = Math.round(amount * 100)
        transactions.push(
          makeTransaction(
            id,
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
              17 + (index % 4),
              5 + index,
            ).toISOString(),
            projectAllocations(
              amountCents,
              projectId,
              id,
              dailyCents ?? 0,
            ),
          ),
        )
      },
    )

    INCOME_SEED.forEach(
      ([day, categoryId, accountId, baseAmount, note], index) => {
        if (day > lastDay) return
        if (categoryId === 'gift-cash' && offset % 2 !== 0) return
        if (
          categoryId === 'investment-dividend' &&
          offset === 0 &&
          now.getDate() < 25
        ) {
          return
        }
        const amount =
          categoryId === 'salary-base'
            ? baseAmount +
              (offset % 3 === 0 ? 400 : offset % 3 === 1 ? 0 : 800)
            : baseAmount
        const id = `sample-${key}-i-${index}`
        const amountCents = Math.round(amount * 100)
        transactions.push(
          makeTransaction(
            id,
            'income',
            amount,
            categoryId,
            accountId,
            dateKey(year, month, day),
            note,
            new Date(year, month, day, 8 + index, 10 + index).toISOString(),
            dailyAllocations(amountCents, id),
          ),
        )
      },
    )
  }

  const currentMonth = monthKey(now.getFullYear(), now.getMonth())
  const previousMonth = monthKey(
    now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear(),
    now.getMonth() === 0 ? 11 : now.getMonth() - 1,
  )
  // months[0] is five months ago; the trip fills the two months before now.
  const yunnanStartMonth = months[3]
  const yunnanEndMonth = months[4]
  const yunnanStart = dateKey(
    yunnanStartMonth.year,
    yunnanStartMonth.month,
    1,
  )
  const yunnanEnd = dateKey(
    yunnanEndMonth.year,
    yunnanEndMonth.month,
    daysInMonth(yunnanEndMonth.year, yunnanEndMonth.month),
  )
  const homeStart = dateKey(months[1].year, months[1].month, 1)
  const fitnessStart = dateKey(
    yunnanEndMonth.year,
    yunnanEndMonth.month,
    15,
  )
  const today = todayKey(now)
  const projectStamp = new Date(
    now.getFullYear(),
    now.getMonth(),
    1,
    8,
    0,
  ).toISOString()

  const projects: Project[] = [
    {
      id: YUNNAN_PROJECT_ID,
      name: '云南旅行',
      code: 'TRIP-YN',
      status: 'closed',
      startDate: yunnanStart,
      endDate: yunnanEnd,
      budgetCents: 800000,
      categoryBudgetsCents: {
        transport: 250000,
        entertainment: 300000,
        food: 150000,
      },
      currency: 'CNY',
      note: '两个人八天的慢旅行，机票和住宿都记在这里。',
      createdAt: new Date(
        yunnanStartMonth.year,
        yunnanStartMonth.month,
        1,
        8,
      ).toISOString(),
      updatedAt: new Date(
        yunnanEndMonth.year,
        yunnanEndMonth.month,
        daysInMonth(yunnanEndMonth.year, yunnanEndMonth.month),
        21,
      ).toISOString(),
    },
    {
      id: HOME_PROJECT_ID,
      name: '新家布置',
      code: 'HOME',
      status: 'active',
      startDate: homeStart,
      budgetCents: 1200000,
      categoryBudgetsCents: {
        shopping: 800000,
        housing: 300000,
        entertainment: 100000,
      },
      countsInDaily: true,
      currency: 'CNY',
      note: '计入日常：布置新家的花费也会消耗每月生活预算。',
      createdAt: new Date(
        months[1].year,
        months[1].month,
        1,
        8,
      ).toISOString(),
      updatedAt: projectStamp,
    },
    {
      id: FITNESS_PROJECT_ID,
      name: '健身计划',
      code: 'FIT',
      status: 'active',
      startDate: fitnessStart,
      budgetCents: 300000,
      categoryBudgetsCents: {
        medical: 60000,
        education: 180000,
        shopping: 60000,
      },
      countsInDaily: true,
      currency: 'CNY',
      note: '体测、私教课和运动装备，计入日常支出。',
      createdAt: new Date(
        yunnanEndMonth.year,
        yunnanEndMonth.month,
        15,
        8,
      ).toISOString(),
      updatedAt: projectStamp,
    },
  ]

  const liabilities: Liability[] = [
    {
      id: 'sample-debt-travel',
      name: '旅行分期',
      principalCents: 600000,
      dueDate: shiftKey(today, 30),
      note: '机票和无息分期，每月还一点。',
      repayments: [
        {
          id: 'sample-repay-travel-1',
          amountCents: 80000,
          date: shiftKey(today, -40),
          note: '第一期',
          createdAt: shiftKey(today, -40) + 'T09:00:00.000Z',
        },
        {
          id: 'sample-repay-travel-2',
          amountCents: 80000,
          date: shiftKey(today, -10),
          note: '第二期',
          createdAt: shiftKey(today, -10) + 'T09:00:00.000Z',
        },
      ],
      createdAt: new Date(
        now.getFullYear(),
        now.getMonth() - 2,
        10,
        10,
      ).toISOString(),
      updatedAt: new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        10,
      ).toISOString(),
    },
    {
      id: 'sample-debt-card',
      name: '信用卡账单',
      principalCents: 420000,
      dueDate: shiftKey(today, -2),
      note: '已过还款日，记得尽快处理。',
      repayments: [
        {
          id: 'sample-repay-card-1',
          amountCents: 200000,
          date: shiftKey(today, -25),
          note: '先还一部分',
          createdAt: shiftKey(today, -25) + 'T09:00:00.000Z',
        },
      ],
      createdAt: new Date(
        now.getFullYear(),
        now.getMonth() - 1,
        5,
        10,
      ).toISOString(),
      updatedAt: new Date(
        now.getFullYear(),
        now.getMonth(),
        1,
        10,
      ).toISOString(),
    },
  ]

  const budgets: BudgetBook = {
    [previousMonth]: {
      month: previousMonth,
      amountCents: 820000,
      dailyMode: 'auto',
      categoryBudgetsCents: {
        housing: 460000,
        food: 160000,
        transport: 45000,
        shopping: 80000,
        entertainment: 50000,
        medical: 25000,
      },
    },
    [currentMonth]: {
      month: currentMonth,
      amountCents: 800000,
      dailyMode: 'auto',
      categoryBudgetsCents: {
        housing: 450000,
        food: 150000,
        transport: 40000,
        shopping: 70000,
        entertainment: 50000,
        medical: 20000,
        education: 20000,
      },
    },
  }

  const budgetRanges: RangeBudget[] = [
    {
      id: 'sample-range-autumn',
      name: '秋日短途',
      startDate: shiftKey(today, -10),
      endDate: shiftKey(today, 4),
      amountCents: 400000,
      dailyMode: 'auto',
      categoryBudgetsCents: {
        food: 120000,
        transport: 100000,
        entertainment: 120000,
      },
    },
  ]

  return {
    accounts: SAMPLE_ACCOUNTS,
    transactions: sortTransactions(transactions),
    projects,
    liabilities,
    budgets,
    budgetRanges,
    openingBalanceCents: 1200000,
  }
}
