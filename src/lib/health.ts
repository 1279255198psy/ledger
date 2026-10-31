import { getCategory, getRootCategoryId } from './categories'
import { getMonthBudgetMetrics, resolveMonthBudget } from './budget'
import { balanceDeltaCents, expenseDeltaCents } from './refunds'
import {
  currentMonthKey,
  daysInMonthOfKey,
  monthLabel,
  monthShortLabel,
  shiftMonth,
} from './utils'
import type {
  BudgetBook,
  IndexGranularity,
  IndexMetricKey,
  LedgerTransaction,
  Liability,
  SpendingNature,
} from '../types'

/**
 * 财务健康指数。
 *
 * 所有数字都从本地流水与负债记录推导：
 * - 流量指标（恩格尔、储蓄率、必要/弹性占比）按所选周期汇总；
 * - 存量指标（活期资产、净资产）取周期末的余额；
 * - 稳定性指标（收入、支出）与预算执行率按近 6 个完整月份滚动计算；
 * - 应急金按月均必要支出折算；
 * - 负债收入比按近 6 个月还款记录估算“每月固定还款”，清零月数用剩余
 *   负债除以同一月均还款。
 *
 * 综合得分只计入当前显示的指标：被隐藏的指标既不展示卡片，也不参与得分，
 * 权重在可见指标之间重新归一化。历史各期的得分同样按同一套可见指标计算。
 */

export const INDEX_METRIC_KEYS: IndexMetricKey[] = [
  'engel',
  'savings',
  'essential',
  'flexible',
  'emergency',
  'debt',
  'netWorth',
  'incomeStability',
  'spendingVolatility',
  'budgetAdherence',
  'netWorthGrowth',
  'debtFreeMonths',
]

const TRAILING_MONTHS = 6
const HISTORY_MONTHS = 12
const HISTORY_QUARTERS = 8
const QUARTER_NAMES = ['一', '二', '三', '四']

const ESSENTIAL_ROOT_IDS = new Set([
  'food',
  'housing',
  'transport',
  'medical',
  'education',
])

const ESSENTIAL_NAME_HINT =
  /餐饮|食品|吃饭|住房|房租|房贷|居住|交通|通勤|医疗|药品|体检|教育|学费|保险/

interface RangeTotals {
  incomeCents: number
  expenseCents: number
  foodCents: number
  essentialCents: number
  flexibleCents: number
  unmarkedCents: number
  unmarkedCount: number
}

export interface HealthScorePart {
  key: IndexMetricKey
  label: string
  score: number | null
  weight: number
}

export interface HealthScore {
  score: number
  grade: string
  tone: 'excellent' | 'healthy' | 'steady' | 'watch' | 'risk'
  comment: string
  focus: string | null
  focusKey: IndexMetricKey | null
  parts: HealthScorePart[]
}

export interface HealthDetail {
  periodKey: string
  periodLabel: string
  periodFullLabel: string
  engel: number | null
  savings: number | null
  essentialRatio: number | null
  flexibleRatio: number | null
  emergencyMonths: number | null
  debtRatio: number | null
  netWorthCents: number
  liquidAssetsCents: number
  totalAssetsCents: number
  totalLiabilitiesCents: number
  totalIncomeCents: number
  totalExpenseCents: number
  essentialCents: number
  flexibleCents: number
  unmarkedCents: number
  unmarkedCount: number
  foodCents: number
  monthlyEssentialCents: number
  monthlyDebtCents: number
  monthlyIncomeCents: number
  incomeStability: number | null
  monthlyIncomeAverageCents: number
  monthlyIncomeDeviationCents: number
  spendingVolatility: number | null
  monthlyExpenseAverageCents: number
  monthlyExpenseDeviationCents: number
  budgetAdherence: number | null
  budgetWithinMonths: number
  budgetTotalMonths: number
  netWorthGrowth: number | null
  netWorthBaseCents: number | null
  debtFreeMonths: number | null
  score: HealthScore | null
}

export interface IndexPoint {
  key: string
  label: string
  fullLabel: string
  value: number | null
}

export type IndexSeries = Record<IndexMetricKey | 'score', IndexPoint[]>

export interface HealthDashboard {
  granularity: IndexGranularity
  detail: HealthDetail
  series: IndexSeries
  unmarkedTotalCount: number
  unmarkedTotalCents: number
}

interface Period {
  key: string
  label: string
  fullLabel: string
  startDate: string
  endDate: string
  endMonth: string
  monthCount: number
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function monthIndexOf(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number)
  return year * 12 + month - 1
}

function endOfMonthDate(monthKey: string): string {
  // ISO date keys compare lexicographically; -31 safely covers every month.
  return `${monthKey}-31`
}

function emptyTotals(): RangeTotals {
  return {
    incomeCents: 0,
    expenseCents: 0,
    foodCents: 0,
    essentialCents: 0,
    flexibleCents: 0,
    unmarkedCents: 0,
    unmarkedCount: 0,
  }
}

function isFoodCategory(categoryId: string): boolean {
  const root = getCategory(getRootCategoryId(categoryId), 'expense')
  return (
    root.id === 'food' ||
    root.name.includes('餐') ||
    root.name.includes('食')
  )
}

/**
 * 用户标记优先。旧流水没有标记时按分类推断，让历史指标仍然可用；
 * 界面上会提示还有多少笔尚未标记。
 */
export function resolveSpendingNature(
  transaction: LedgerTransaction,
): SpendingNature {
  if (
    transaction.spendingNature === 'essential' ||
    transaction.spendingNature === 'flexible'
  ) {
    return transaction.spendingNature
  }
  const root = getCategory(
    getRootCategoryId(transaction.categoryId),
    'expense',
  )
  if (ESSENTIAL_ROOT_IDS.has(root.id)) return 'essential'
  if (ESSENTIAL_NAME_HINT.test(root.name)) return 'essential'
  return 'flexible'
}

function totalsInRange(
  transactions: LedgerTransaction[],
  startDate: string,
  endDate: string,
): RangeTotals {
  const totals = emptyTotals()
  for (const transaction of transactions) {
    if (transaction.date < startDate || transaction.date > endDate) continue
    if (transaction.type === 'income') {
      totals.incomeCents += transaction.amountCents
      continue
    }

    // A refund carries the same nature as the purchase it reverses, so every
    // bucket here shrinks instead of growing.
    const delta = expenseDeltaCents(transaction)
    totals.expenseCents += delta
    if (isFoodCategory(transaction.categoryId)) {
      totals.foodCents += delta
    }
    if (
      transaction.spendingNature === 'essential' ||
      transaction.spendingNature === 'flexible'
    ) {
      if (transaction.spendingNature === 'essential') {
        totals.essentialCents += delta
      } else {
        totals.flexibleCents += delta
      }
    } else {
      totals.unmarkedCents += delta
      totals.unmarkedCount += 1
      if (resolveSpendingNature(transaction) === 'essential') {
        totals.essentialCents += delta
      } else {
        totals.flexibleCents += delta
      }
    }
  }
  return totals
}

function assetsAtEnd(
  transactions: LedgerTransaction[],
  openingBalanceCents: number,
  endDate: string,
): number {
  let balance = openingBalanceCents
  for (const transaction of transactions) {
    if (transaction.date > endDate) continue
    balance += balanceDeltaCents(transaction)
  }
  return balance
}

function liabilitiesAtEnd(
  liabilities: Liability[],
  endDate: string,
): number {
  let remaining = 0
  for (const liability of liabilities) {
    if (liability.createdAt.slice(0, 10) > endDate) continue
    const repaid = liability.repayments.reduce(
      (total, repayment) =>
        repayment.date <= endDate ? total + repayment.amountCents : total,
      0,
    )
    remaining += Math.max(liability.principalCents - repaid, 0)
  }
  return remaining
}

interface HealthContext {
  transactions: LedgerTransaction[]
  liabilities: Liability[]
  budgets: BudgetBook
  countedProjectIds?: ReadonlySet<string>
  earliestMonth: string | null
  hidden: ReadonlySet<IndexMetricKey>
  /** Monthly aggregates are reused across the twelve period windows. */
  monthTotalsCache: Map<string, RangeTotals>
  budgetCache: Map<
    string,
    { spentCents: number; baseAmountCents: number } | null
  >
}

function monthTotalsFor(
  ctx: HealthContext,
  monthKey: string,
): RangeTotals {
  const cached = ctx.monthTotalsCache.get(monthKey)
  if (cached) return cached
  const totals = totalsInRange(
    ctx.transactions,
    `${monthKey}-01`,
    endOfMonthDate(monthKey),
  )
  ctx.monthTotalsCache.set(monthKey, totals)
  return totals
}

function essentialForMonth(
  ctx: HealthContext,
  monthKey: string,
): number {
  const totals = monthTotalsFor(ctx, monthKey)
  if (monthKey === currentMonthKey()) {
    const elapsed = Math.max(new Date().getDate(), 1)
    return Math.round(
      (totals.essentialCents * daysInMonthOfKey(monthKey)) / elapsed,
    )
  }
  return totals.essentialCents
}

function earliestTransactionMonth(
  transactions: LedgerTransaction[],
): string | null {
  let earliest: string | null = null
  for (const transaction of transactions) {
    const month = transaction.date.slice(0, 7)
    if (!earliest || month < earliest) earliest = month
  }
  return earliest
}

function trailingMonthKeys(
  endMonth: string,
  earliestMonth: string | null,
  count: number,
): string[] {
  const keys: string[] = []
  for (let index = count - 1; index >= 0; index -= 1) {
    const key = shiftMonth(endMonth, -index)
    if (
      !earliestMonth ||
      monthIndexOf(key) >= monthIndexOf(earliestMonth)
    ) {
      keys.push(key)
    }
  }
  return keys
}

function averageMonthlyEssential(
  ctx: HealthContext,
  endMonth: string,
): number {
  const keys = trailingMonthKeys(
    endMonth,
    ctx.earliestMonth,
    TRAILING_MONTHS,
  )
  if (keys.length === 0) return 0
  const total = keys.reduce(
    (sum, key) => sum + essentialForMonth(ctx, key),
    0,
  )
  return Math.round(total / keys.length)
}

/**
 * Rolling window for the stability metrics. The current month is still in
 * progress, so only completed months are used; older selections use the
 * selected month as the end of their own window.
 */
function completedMonthWindow(
  endMonth: string,
  earliestMonth: string | null,
): string[] {
  const current = currentMonthKey()
  const anchor = endMonth >= current ? shiftMonth(current, -1) : endMonth
  return trailingMonthKeys(anchor, earliestMonth, TRAILING_MONTHS)
}

function averageAndDeviation(values: number[]): {
  average: number
  deviation: number
} {
  const average =
    values.reduce((sum, value) => sum + value, 0) / values.length
  const variance =
    values.reduce(
      (sum, value) => sum + (value - average) ** 2,
      0,
    ) / values.length
  return { average, deviation: Math.sqrt(variance) }
}

interface FlowStats {
  incomeStability: number | null
  incomeAverageCents: number
  incomeDeviationCents: number
  spendingVolatility: number | null
  expenseAverageCents: number
  expenseDeviationCents: number
}

function flowStats(ctx: HealthContext, endMonth: string): FlowStats {
  const keys = completedMonthWindow(endMonth, ctx.earliestMonth)
  if (keys.length < 3) {
    return {
      incomeStability: null,
      incomeAverageCents: 0,
      incomeDeviationCents: 0,
      spendingVolatility: null,
      expenseAverageCents: 0,
      expenseDeviationCents: 0,
    }
  }

  const incomes = keys.map(
    (key) => monthTotalsFor(ctx, key).incomeCents,
  )
  const expenses = keys.map(
    (key) => monthTotalsFor(ctx, key).expenseCents,
  )
  const income = averageAndDeviation(incomes)
  const expense = averageAndDeviation(expenses)

  return {
    incomeStability:
      income.average > 0
        ? (income.deviation / income.average) * 100
        : null,
    incomeAverageCents: Math.round(income.average),
    incomeDeviationCents: Math.round(income.deviation),
    spendingVolatility:
      expense.average > 0
        ? (expense.deviation / expense.average) * 100
        : null,
    expenseAverageCents: Math.round(expense.average),
    expenseDeviationCents: Math.round(expense.deviation),
  }
}

interface BudgetAdherenceStats {
  within: number
  total: number
  ratio: number | null
}

/**
 * Completed months that actually carry a budget. Months that would only use
 * the default plan are skipped, otherwise a user who never opened the budget
 * page would appear to be failing a budget they never set.
 *
 * The comparison uses the original plan (baseAmountCents), not the amount
 * after a dynamic adjustment — raising or lowering the budget mid-month
 * should not rewrite whether the month was kept within its original plan.
 */
function budgetAdherenceStats(
  ctx: HealthContext,
  endMonth: string,
): BudgetAdherenceStats {
  const keys = completedMonthWindow(endMonth, ctx.earliestMonth)
  let within = 0
  let total = 0
  for (const key of keys) {
    if (!ctx.budgetCache.has(key)) {
      const resolved = resolveMonthBudget(ctx.budgets, key)
      ctx.budgetCache.set(
        key,
        resolved.source === 'default'
          ? null
          : getMonthBudgetMetrics(
              ctx.transactions,
              key,
              ctx.budgets,
              ctx.countedProjectIds,
            ),
      )
    }
    const metrics = ctx.budgetCache.get(key)
    if (!metrics) continue
    total += 1
    if (metrics.spentCents <= metrics.baseAmountCents) within += 1
  }
  return {
    within,
    total,
    ratio: total > 0 ? (within / total) * 100 : null,
  }
}

interface DebtStats {
  monthlyDebtCents: number
  monthlyIncomeCents: number
  ratio: number | null
}

function debtStats(
  transactions: LedgerTransaction[],
  liabilities: Liability[],
  monthKey: string,
  earliestMonth: string | null,
): DebtStats {
  // Use completed months for a stable "fixed monthly repayment" estimate.
  const previousMonth = shiftMonth(monthKey, -1)
  let keys = trailingMonthKeys(
    previousMonth,
    earliestMonth,
    TRAILING_MONTHS,
  )
  if (keys.length === 0) keys = [monthKey]

  const first = keys[0]
  const last = keys[keys.length - 1]
  const startDate = `${first}-01`
  const endDate = endOfMonthDate(last)

  let repayCents = 0
  for (const liability of liabilities) {
    for (const repayment of liability.repayments) {
      if (repayment.date >= startDate && repayment.date <= endDate) {
        repayCents += repayment.amountCents
      }
    }
  }

  let incomeCents = 0
  for (const transaction of transactions) {
    if (
      transaction.type === 'income' &&
      transaction.date >= startDate &&
      transaction.date <= endDate
    ) {
      incomeCents += transaction.amountCents
    }
  }

  return {
    monthlyDebtCents: Math.round(repayCents / keys.length),
    monthlyIncomeCents: Math.round(incomeCents / keys.length),
    ratio: incomeCents > 0 ? (repayCents / incomeCents) * 100 : null,
  }
}

function buildPeriods(
  monthKey: string,
  granularity: IndexGranularity,
): Period[] {
  const current = currentMonthKey()
  if (granularity === 'month') {
    const periods: Period[] = []
    for (let index = HISTORY_MONTHS - 1; index >= 0; index -= 1) {
      const key = shiftMonth(monthKey, -index)
      periods.push({
        key,
        label: monthShortLabel(key),
        fullLabel: monthLabel(key),
        startDate: `${key}-01`,
        endDate: endOfMonthDate(key),
        endMonth: key,
        monthCount: 1,
      })
    }
    return periods
  }

  const [year, month] = monthKey.split('-').map(Number)
  const quarterIndex = Math.floor((month - 1) / 3)
  const base = year * 4 + quarterIndex
  const periods: Period[] = []
  for (let index = HISTORY_QUARTERS - 1; index >= 0; index -= 1) {
    const absolute = base - index
    const periodYear = Math.floor(absolute / 4)
    const periodQuarter = absolute % 4
    const startMonth = `${periodYear}-${pad(periodQuarter * 3 + 1)}`
    const quarterEndMonth = `${periodYear}-${pad(
      periodQuarter * 3 + 3,
    )}`
    // The current quarter is measured to date; completed quarters are full.
    const endMonth =
      quarterEndMonth >= current ? current : quarterEndMonth
    const monthCount =
      monthIndexOf(endMonth) - monthIndexOf(startMonth) + 1
    periods.push({
      key: `${periodYear}-Q${periodQuarter + 1}`,
      label: `${String(periodYear).slice(2)}Q${periodQuarter + 1}`,
      fullLabel: `${periodYear} 年第${QUARTER_NAMES[periodQuarter]}季度`,
      startDate: `${startMonth}-01`,
      endDate: endOfMonthDate(endMonth),
      endMonth,
      monthCount: Math.max(monthCount, 1),
    })
  }
  return periods
}

function piecewise(
  value: number,
  points: Array<[number, number]>,
): number {
  if (value <= points[0][0]) return points[0][1]
  for (let index = 1; index < points.length; index += 1) {
    const [x, y] = points[index]
    const [previousX, previousY] = points[index - 1]
    if (value <= x) {
      const ratio = (value - previousX) / (x - previousX)
      return previousY + (y - previousY) * ratio
    }
  }
  return points[points.length - 1][1]
}

function clampScore(value: number): number {
  return Math.min(Math.max(value, 0), 100)
}

interface ScoreInput {
  hasActivity: boolean
  savings: number | null
  emergencyMonths: number | null
  debtRatio: number | null
  essentialRatio: number | null
  engel: number | null
  netWorthCents: number
  monthlyIncomeCents: number
  totalLiabilitiesCents: number
  incomeStability: number | null
  spendingVolatility: number | null
  budgetAdherence: number | null
  netWorthGrowth: number | null
  debtFreeMonths: number | null
}

function netWorthScore(
  netWorthCents: number,
  monthlyIncomeCents: number,
): number {
  if (monthlyIncomeCents <= 0) {
    return netWorthCents > 0 ? 78 : netWorthCents < 0 ? 22 : 50
  }
  const annualIncome = monthlyIncomeCents * 12
  const coverage = netWorthCents / annualIncome
  return piecewise(coverage, [
    [-1, 0],
    [-0.5, 18],
    [0, 45],
    [0.5, 68],
    [1, 84],
    [2, 94],
    [3, 100],
  ])
}

const GRADE_COPY: Record<
  HealthScore['tone'],
  { grade: string; comment: string }
> = {
  excellent: {
    grade: '优秀',
    comment: '收支从容、缓冲充足，是一份很有韧性的财务底盘。',
  },
  healthy: {
    grade: '健康',
    comment: '整体健康，留一点余量给生活里的意外。',
  },
  steady: {
    grade: '稳健',
    comment: '底盘尚稳，个别指标还有打磨的空间。',
  },
  watch: {
    grade: '需留意',
    comment: '现金流开始吃紧，先把最薄弱的一环补上。',
  },
  risk: {
    grade: '风险',
    comment: '收支与负债压力同时偏高，建议尽快收紧弹性支出。',
  },
}

const FOCUS_ADVICE: Record<IndexMetricKey, string> = {
  savings: '每月先留下结余，再安排花销。',
  emergency: '应急金还不够厚，慢慢补到 3–6 个月的必要支出。',
  debt: '还款占收入偏高，优先处理利率最高的债务。',
  essential: '刚需占比偏高，弹性空间正在被压缩。',
  engel: '餐饮占比较高，可以从外食和饮品开始调整。',
  flexible: '弹性消费偏高，给非必要花销设一个上限。',
  netWorth: '净资产仍偏薄或为负，先让资产端转正。',
  incomeStability: '收入起伏较大，先留出更厚的缓冲再安排大额花销。',
  spendingVolatility: '支出起伏偏大，给非固定花销设一个月度上限。',
  budgetAdherence: '预算经常被突破，先从最容易超支的分类开始收紧。',
  netWorthGrowth: '净资产在回落，检查近期大额支出与负债变化。',
  debtFreeMonths: '按当前还款速度，负债还要较长时间才能清零。',
}

function buildScore(
  input: ScoreInput,
  hidden: ReadonlySet<IndexMetricKey>,
): HealthScore | null {
  if (!input.hasActivity) return null

  const allParts: HealthScorePart[] = [
    {
      key: 'savings',
      label: '储蓄率',
      weight: 17,
      score:
        input.savings === null
          ? null
          : clampScore(
              piecewise(input.savings, [
                [-20, 0],
                [0, 30],
                [5, 48],
                [10, 62],
                [20, 80],
                [30, 92],
                [40, 100],
              ]),
            ),
    },
    {
      key: 'emergency',
      label: '应急金',
      weight: 17,
      score:
        input.emergencyMonths === null
          ? null
          : clampScore(
              piecewise(input.emergencyMonths, [
                [0, 0],
                [1, 22],
                [3, 62],
                [6, 100],
              ]),
            ),
    },
    {
      key: 'debt',
      label: '负债收入比',
      weight: 11,
      score:
        input.debtRatio === null
          ? null
          : clampScore(
              piecewise(input.debtRatio, [
                [0, 100],
                [20, 100],
                [35, 78],
                [50, 50],
                [70, 20],
                [100, 0],
              ]),
            ),
    },
    {
      key: 'essential',
      label: '必要支出占比',
      weight: 9,
      score:
        input.essentialRatio === null
          ? null
          : clampScore(
              piecewise(input.essentialRatio, [
                [40, 100],
                [60, 100],
                [70, 88],
                [80, 65],
                [90, 35],
                [100, 10],
              ]),
            ),
    },
    {
      key: 'engel',
      label: '恩格尔系数',
      weight: 8,
      score:
        input.engel === null
          ? null
          : clampScore(
              piecewise(input.engel, [
                [20, 100],
                [30, 100],
                [40, 90],
                [50, 72],
                [60, 50],
                [80, 20],
              ]),
            ),
    },
    {
      key: 'netWorth',
      label: '净资产',
      weight: 7,
      score:
        input.netWorthCents === 0 && input.totalLiabilitiesCents === 0
          ? null
          : clampScore(
              netWorthScore(
                input.netWorthCents,
                input.monthlyIncomeCents,
              ),
            ),
    },
    {
      key: 'incomeStability',
      label: '收入稳定性',
      weight: 8,
      score:
        input.incomeStability === null
          ? null
          : clampScore(
              piecewise(input.incomeStability, [
                [0, 100],
                [10, 95],
                [20, 82],
                [30, 65],
                [45, 40],
                [60, 15],
                [80, 0],
              ]),
            ),
    },
    {
      key: 'spendingVolatility',
      label: '支出波动率',
      weight: 4,
      score:
        input.spendingVolatility === null
          ? null
          : clampScore(
              piecewise(input.spendingVolatility, [
                [0, 100],
                [15, 95],
                [25, 85],
                [40, 60],
                [55, 38],
                [75, 12],
                [100, 0],
              ]),
            ),
    },
    {
      key: 'budgetAdherence',
      label: '预算执行率',
      weight: 9,
      score:
        input.budgetAdherence === null
          ? null
          : clampScore(
              piecewise(input.budgetAdherence, [
                [0, 0],
                [40, 40],
                [60, 62],
                [80, 85],
                [90, 95],
                [100, 100],
              ]),
            ),
    },
    {
      key: 'netWorthGrowth',
      label: '净资产增长率',
      weight: 5,
      score:
        input.netWorthGrowth === null
          ? null
          : clampScore(
              piecewise(input.netWorthGrowth, [
                [-40, 0],
                [-20, 15],
                [-10, 32],
                [0, 50],
                [10, 65],
                [20, 78],
                [30, 88],
                [50, 97],
                [80, 100],
              ]),
            ),
    },
    {
      key: 'debtFreeMonths',
      label: '负债清零月数',
      weight: 5,
      score:
        input.debtFreeMonths === null
          ? null
          : clampScore(
              piecewise(input.debtFreeMonths, [
                [0, 100],
                [6, 95],
                [12, 88],
                [24, 72],
                [36, 56],
                [60, 30],
                [120, 5],
                [180, 0],
              ]),
            ),
    },
  ]

  const parts = allParts.filter((part) => !hidden.has(part.key))

  const visibleWeightTotal = parts.reduce(
    (sum, part) => sum + part.weight,
    0,
  )

  const available = parts.filter(
    (part): part is HealthScorePart & { score: number } =>
      part.score !== null,
  )
  if (available.length === 0) return null

  const totalWeight = available.reduce(
    (sum, part) => sum + part.weight,
    0,
  )
  const score = Math.round(
    available.reduce(
      (sum, part) => sum + part.score * part.weight,
      0,
    ) / totalWeight,
  )

  const tone: HealthScore['tone'] =
    score >= 85
      ? 'excellent'
      : score >= 70
        ? 'healthy'
        : score >= 55
          ? 'steady'
          : score >= 40
            ? 'watch'
            : 'risk'
  const copy = GRADE_COPY[tone]

  const weakest = available.reduce((lowest, part) =>
    part.score < lowest.score ? part : lowest,
  )
  const focus = weakest.score < 72 ? weakest.label : null
  const comment =
    weakest.score < 72
      ? `${copy.comment} ${FOCUS_ADVICE[weakest.key]}`
      : copy.comment

  return {
    score,
    grade: copy.grade,
    tone,
    comment,
    focus,
    focusKey: focus ? weakest.key : null,
    // Show the weight as a share of the visible metrics so the listed
    // percentages still add up after hiding some of them.
    parts: parts.map((part) => ({
      ...part,
      weight:
        visibleWeightTotal > 0
          ? Math.round((part.weight / visibleWeightTotal) * 100)
          : 0,
    })),
  }
}

function computeDetail(
  ctx: HealthContext,
  openingBalanceCents: number,
  period: Period,
  netWorthBaseCents: number | null,
): HealthDetail {
  const totals = totalsInRange(
    ctx.transactions,
    period.startDate,
    period.endDate,
  )
  const liquidAssetsCents = assetsAtEnd(
    ctx.transactions,
    openingBalanceCents,
    period.endDate,
  )
  const totalLiabilitiesCents = liabilitiesAtEnd(
    ctx.liabilities,
    period.endDate,
  )
  const netWorthCents = liquidAssetsCents - totalLiabilitiesCents
  const monthlyEssentialCents = averageMonthlyEssential(
    ctx,
    period.endMonth,
  )
  const debt = debtStats(
    ctx.transactions,
    ctx.liabilities,
    period.endMonth,
    ctx.earliestMonth,
  )
  const flows = flowStats(ctx, period.endMonth)
  const budget = budgetAdherenceStats(ctx, period.endMonth)

  const engel =
    totals.expenseCents > 0
      ? (totals.foodCents / totals.expenseCents) * 100
      : null
  const savings =
    totals.incomeCents > 0
      ? ((totals.incomeCents - totals.expenseCents) /
          totals.incomeCents) *
        100
      : null
  const essentialRatio =
    totals.expenseCents > 0
      ? (totals.essentialCents / totals.expenseCents) * 100
      : null
  const flexibleRatio =
    totals.expenseCents > 0
      ? (totals.flexibleCents / totals.expenseCents) * 100
      : null
  const emergencyMonths =
    monthlyEssentialCents > 0
      ? liquidAssetsCents / monthlyEssentialCents
      : null
  const netWorthGrowth =
    netWorthBaseCents !== null && netWorthBaseCents !== 0
      ? ((netWorthCents - netWorthBaseCents) /
          Math.abs(netWorthBaseCents)) *
        100
      : null
  const debtFreeMonths =
    totalLiabilitiesCents <= 0
      ? 0
      : debt.monthlyDebtCents > 0
        ? totalLiabilitiesCents / debt.monthlyDebtCents
        : null

  const monthlyIncomeCents =
    debt.monthlyIncomeCents > 0
      ? debt.monthlyIncomeCents
      : Math.round(totals.incomeCents / period.monthCount)

  const score = buildScore(
    {
      hasActivity:
        totals.incomeCents + totals.expenseCents > 0,
      savings,
      emergencyMonths,
      debtRatio: debt.ratio,
      essentialRatio,
      engel,
      netWorthCents,
      monthlyIncomeCents,
      totalLiabilitiesCents,
      incomeStability: flows.incomeStability,
      spendingVolatility: flows.spendingVolatility,
      budgetAdherence: budget.ratio,
      netWorthGrowth,
      debtFreeMonths,
    },
    ctx.hidden,
  )

  return {
    periodKey: period.key,
    periodLabel: period.label,
    periodFullLabel: period.fullLabel,
    engel,
    savings,
    essentialRatio,
    flexibleRatio,
    emergencyMonths,
    debtRatio: debt.ratio,
    netWorthCents,
    liquidAssetsCents,
    totalAssetsCents: liquidAssetsCents,
    totalLiabilitiesCents,
    totalIncomeCents: totals.incomeCents,
    totalExpenseCents: totals.expenseCents,
    essentialCents: totals.essentialCents,
    flexibleCents: totals.flexibleCents,
    unmarkedCents: totals.unmarkedCents,
    unmarkedCount: totals.unmarkedCount,
    foodCents: totals.foodCents,
    monthlyEssentialCents,
    monthlyDebtCents: debt.monthlyDebtCents,
    monthlyIncomeCents,
    incomeStability: flows.incomeStability,
    monthlyIncomeAverageCents: flows.incomeAverageCents,
    monthlyIncomeDeviationCents: flows.incomeDeviationCents,
    spendingVolatility: flows.spendingVolatility,
    monthlyExpenseAverageCents: flows.expenseAverageCents,
    monthlyExpenseDeviationCents: flows.expenseDeviationCents,
    budgetAdherence: budget.ratio,
    budgetWithinMonths: budget.within,
    budgetTotalMonths: budget.total,
    netWorthGrowth,
    netWorthBaseCents,
    debtFreeMonths,
    score,
  }
}

function toPoints(
  periods: Period[],
  details: HealthDetail[],
  pick: (detail: HealthDetail) => number | null,
): IndexPoint[] {
  return periods.map((period, index) => ({
    key: period.key,
    label: period.label,
    fullLabel: period.fullLabel,
    value: pick(details[index]),
  }))
}

export interface HealthDashboardOptions {
  /** Metrics excluded from both the score and the historical score series. */
  hidden?: ReadonlySet<IndexMetricKey>
  budgets?: BudgetBook
  countedProjectIds?: ReadonlySet<string>
}

export function buildHealthDashboard(
  transactions: LedgerTransaction[],
  liabilities: Liability[],
  openingBalanceCents: number,
  monthKey: string,
  granularity: IndexGranularity,
  options: HealthDashboardOptions = {},
): HealthDashboard {
  const periods = buildPeriods(monthKey, granularity)
  const earliestMonth = earliestTransactionMonth(transactions)
  const ctx: HealthContext = {
    transactions,
    liabilities,
    budgets: options.budgets ?? {},
    countedProjectIds: options.countedProjectIds,
    earliestMonth,
    hidden: options.hidden ?? new Set(),
    monthTotalsCache: new Map(),
    budgetCache: new Map(),
  }
  const details = periods.map((period) => {
    // Net worth growth compares with the same point half a year earlier. For
    // quarters that is exactly two quarters back, so one rule covers both
    // granularities and every historical point gets a baseline.
    const baseEndDate = endOfMonthDate(
      shiftMonth(period.endMonth, -6),
    )
    const netWorthBaseCents =
      assetsAtEnd(transactions, openingBalanceCents, baseEndDate) -
      liabilitiesAtEnd(liabilities, baseEndDate)
    return computeDetail(
      ctx,
      openingBalanceCents,
      period,
      netWorthBaseCents,
    )
  })
  const current = details[details.length - 1]

  let unmarkedTotalCount = 0
  let unmarkedTotalCents = 0
  for (const transaction of transactions) {
    if (
      transaction.type === 'expense' &&
      transaction.spendingNature !== 'essential' &&
      transaction.spendingNature !== 'flexible'
    ) {
      unmarkedTotalCount += 1
      unmarkedTotalCents += transaction.amountCents
    }
  }

  return {
    granularity,
    detail: current,
    series: {
      engel: toPoints(periods, details, (detail) => detail.engel),
      savings: toPoints(periods, details, (detail) => detail.savings),
      essential: toPoints(
        periods,
        details,
        (detail) => detail.essentialRatio,
      ),
      flexible: toPoints(
        periods,
        details,
        (detail) => detail.flexibleRatio,
      ),
      emergency: toPoints(
        periods,
        details,
        (detail) => detail.emergencyMonths,
      ),
      debt: toPoints(periods, details, (detail) => detail.debtRatio),
      netWorth: toPoints(
        periods,
        details,
        (detail) => detail.netWorthCents / 100,
      ),
      incomeStability: toPoints(
        periods,
        details,
        (detail) => detail.incomeStability,
      ),
      spendingVolatility: toPoints(
        periods,
        details,
        (detail) => detail.spendingVolatility,
      ),
      budgetAdherence: toPoints(
        periods,
        details,
        (detail) => detail.budgetAdherence,
      ),
      netWorthGrowth: toPoints(
        periods,
        details,
        (detail) => detail.netWorthGrowth,
      ),
      debtFreeMonths: toPoints(
        periods,
        details,
        (detail) => detail.debtFreeMonths,
      ),
      score: toPoints(
        periods,
        details,
        (detail) => detail.score?.score ?? null,
      ),
    },
    unmarkedTotalCount,
    unmarkedTotalCents,
  }
}
