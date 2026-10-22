import { getCategory, getRootCategoryId } from './categories'
import {
  currentMonthKey,
  daysInMonthOfKey,
  monthLabel,
  monthShortLabel,
  shiftMonth,
} from './utils'
import type {
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
 * - 应急金按月均必要支出折算；
 * - 负债收入比按近 6 个月还款记录估算“每月固定还款”。
 */

export const INDEX_METRIC_KEYS: IndexMetricKey[] = [
  'engel',
  'savings',
  'essential',
  'flexible',
  'emergency',
  'debt',
  'netWorth',
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

    totals.expenseCents += transaction.amountCents
    if (isFoodCategory(transaction.categoryId)) {
      totals.foodCents += transaction.amountCents
    }
    if (
      transaction.spendingNature === 'essential' ||
      transaction.spendingNature === 'flexible'
    ) {
      if (transaction.spendingNature === 'essential') {
        totals.essentialCents += transaction.amountCents
      } else {
        totals.flexibleCents += transaction.amountCents
      }
    } else {
      totals.unmarkedCents += transaction.amountCents
      totals.unmarkedCount += 1
      if (resolveSpendingNature(transaction) === 'essential') {
        totals.essentialCents += transaction.amountCents
      } else {
        totals.flexibleCents += transaction.amountCents
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
    balance +=
      transaction.type === 'income'
        ? transaction.amountCents
        : -transaction.amountCents
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

function essentialForMonth(
  transactions: LedgerTransaction[],
  monthKey: string,
): number {
  const totals = totalsInRange(
    transactions,
    `${monthKey}-01`,
    endOfMonthDate(monthKey),
  )
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
  transactions: LedgerTransaction[],
  endMonth: string,
  earliestMonth: string | null,
): number {
  const keys = trailingMonthKeys(
    endMonth,
    earliestMonth,
    TRAILING_MONTHS,
  )
  if (keys.length === 0) return 0
  const total = keys.reduce(
    (sum, key) => sum + essentialForMonth(transactions, key),
    0,
  )
  return Math.round(total / keys.length)
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
}

function buildScore(input: ScoreInput): HealthScore | null {
  if (!input.hasActivity) return null

  const parts: HealthScorePart[] = [
    {
      key: 'savings',
      label: '储蓄率',
      weight: 22,
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
      weight: 22,
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
      weight: 20,
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
      weight: 14,
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
      weight: 12,
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
      weight: 10,
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
  ]

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
    parts,
  }
}

function computeDetail(
  transactions: LedgerTransaction[],
  liabilities: Liability[],
  openingBalanceCents: number,
  period: Period,
  earliestMonth: string | null,
): HealthDetail {
  const totals = totalsInRange(
    transactions,
    period.startDate,
    period.endDate,
  )
  const liquidAssetsCents = assetsAtEnd(
    transactions,
    openingBalanceCents,
    period.endDate,
  )
  const totalLiabilitiesCents = liabilitiesAtEnd(
    liabilities,
    period.endDate,
  )
  const netWorthCents = liquidAssetsCents - totalLiabilitiesCents
  const monthlyEssentialCents = averageMonthlyEssential(
    transactions,
    period.endMonth,
    earliestMonth,
  )
  const debt = debtStats(
    transactions,
    liabilities,
    period.endMonth,
    earliestMonth,
  )

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

  const monthlyIncomeCents =
    debt.monthlyIncomeCents > 0
      ? debt.monthlyIncomeCents
      : Math.round(totals.incomeCents / period.monthCount)

  const score = buildScore({
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
  })

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

export function buildHealthDashboard(
  transactions: LedgerTransaction[],
  liabilities: Liability[],
  openingBalanceCents: number,
  monthKey: string,
  granularity: IndexGranularity,
): HealthDashboard {
  const periods = buildPeriods(monthKey, granularity)
  const earliestMonth = earliestTransactionMonth(transactions)
  const details = periods.map((period) =>
    computeDetail(
      transactions,
      liabilities,
      openingBalanceCents,
      period,
      earliestMonth,
    ),
  )
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
