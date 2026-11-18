import type { GoalPlan, GoalPlanKey } from '../types'
import { localDateKey } from './utils'

/**
 * What the planner knows about the household's recent cash flow. Amounts are
 * cents; `surplusVolatility` is the coefficient of variation of monthly net
 * surplus (0 = very steady, 1 = as large as the average itself).
 */
export interface GoalPlanContext {
  averageIncomeCents: number
  averageExpenseCents: number
  averageEssentialCents: number
  monthCount: number
  surplusVolatility: number
  monthlyDebtCents: number
  liquidBalanceCents: number
}

function monthIndexOf(dateKey: string): number {
  const [year, month] = dateKey.split('-').map(Number)
  return year * 12 + (month - 1)
}

function addMonthsToKey(dateKey: string, months: number): string {
  const total = monthIndexOf(dateKey) + months
  const year = Math.floor(total / 12)
  const month = (total % 12) + 1
  return `${year}-${String(month).padStart(2, '0')}`
}

/** Months from one date to another, never below one. */
export function monthsUntil(fromDate: string, toDate: string): number {
  return Math.max(monthIndexOf(toDate) - monthIndexOf(fromDate), 1)
}

/** Rounds a monthly amount to a friendly unit people actually budget in. */
function roundFriendly(cents: number): number {
  if (cents <= 0) return 0
  const unit = cents < 100_000 ? 5_000 : cents < 500_000 ? 10_000 : 50_000
  return Math.max(Math.ceil(cents / unit) * unit, unit)
}

function formatMoneyPlain(cents: number): string {
  return `¥${(cents / 100).toLocaleString('zh-CN', {
    maximumFractionDigits: 0,
  })}`
}

function confidenceOf(monthCount: number): number {
  if (monthCount >= 6) return 1
  if (monthCount >= 3) return 0.85
  if (monthCount >= 1) return 0.65
  return 0.5
}

function volatilityPenalty(volatility: number): number {
  if (volatility <= 0.25) return 1
  if (volatility <= 0.5) return 0.85
  if (volatility <= 0.75) return 0.7
  return 0.55
}

function bufferPenalty(context: GoalPlanContext): number {
  const essential = Math.max(
    context.averageEssentialCents,
    context.averageExpenseCents * 0.6,
    0,
  )
  if (essential <= 0) return 0.9
  if (context.liquidBalanceCents >= essential * 3) return 1
  if (context.liquidBalanceCents >= essential) return 0.9
  return 0.75
}

function makePlan(
  key: GoalPlanKey,
  label: string,
  monthlyCents: number,
  remainingCents: number,
  today: string,
  detail: string,
  feasible: boolean,
  warning?: string,
): GoalPlan {
  const monthly = Math.max(roundFriendly(monthlyCents), 5_000)
  const months = Math.min(
    Math.max(Math.ceil(remainingCents / Math.max(monthly, 1)), 1),
    600,
  )
  return {
    key,
    label,
    monthlyCents: monthly,
    months,
    finishMonth: addMonthsToKey(today, months),
    detail,
    feasible,
    ...(warning ? { warning } : {}),
  }
}

/**
 * Builds three or four actionable plans from real cash flow:
 * - a deadline plan when a target date exists;
 * - a balanced plan that leaves room for daily life and an emergency buffer;
 * - a slower and a faster option.
 *
 * The balanced amount starts from the average net surplus, then subtracts
 * debt repayments and other goals' commitments, and is reduced when income is
 * volatile, the history is short, or the liquid buffer is thin.
 */
export function buildGoalPlans(
  remainingCents: number,
  context: GoalPlanContext,
  targetDate: string | undefined,
  committedMonthlyCents = 0,
  today = localDateKey(),
): GoalPlan[] {
  if (remainingCents <= 0) return []

  const averageSurplus = Math.max(
    context.averageIncomeCents - context.averageExpenseCents,
    0,
  )
  const freeMonthly = Math.max(
    averageSurplus - context.monthlyDebtCents - committedMonthlyCents,
    0,
  )
  const monthLabel = context.monthCount > 0 ? `${context.monthCount} 个完整月` : '现有数据'
  const reasoning = `近 ${monthLabel}平均结余 ${formatMoneyPlain(
    averageSurplus,
  )}，扣除每月还款与其他目标后可用 ${formatMoneyPlain(freeMonthly)}`

  if (freeMonthly <= 0) {
    if (!targetDate) return []
    const months = monthsUntil(today, targetDate)
    const required = Math.ceil(remainingCents / months)
    return [
      makePlan(
        'deadline',
        '按目标日',
        required,
        remainingCents,
        today,
        `目标日期还有 ${months} 个月，按剩余月份平摊`,
        false,
        '当前没有可支配结余，先增加收入或减少固定支出，或把目标日期往后延。',
      ),
    ]
  }

  const capacity =
    freeMonthly *
    0.6 *
    confidenceOf(context.monthCount) *
    volatilityPenalty(context.surplusVolatility) *
    bufferPenalty(context)

  const plans: GoalPlan[] = []
  const add = (plan: GoalPlan) => {
    if (plans.some((item) => item.monthlyCents === plan.monthlyCents)) return
    plans.push(plan)
  }

  if (targetDate) {
    const months = monthsUntil(today, targetDate)
    const required = Math.ceil(remainingCents / months)
    const feasible = required <= freeMonthly
    add(
      makePlan(
        'deadline',
        feasible ? '按目标日' : '目标日偏紧',
        required,
        remainingCents,
        today,
        `想在 ${targetDate} 前达成，需要每月存 ${formatMoneyPlain(required)}`,
        feasible,
        feasible
          ? undefined
          : `按目标日需要每月 ${formatMoneyPlain(
              required,
            )}，高于当前可安排的上限 ${formatMoneyPlain(
              freeMonthly,
            )}；可以延长日期或降低目标。`,
      ),
    )
  }

  const balanced = Math.max(roundFriendly(capacity), 5_000)
  add(
    makePlan(
      'balanced',
      '推荐',
      balanced,
      remainingCents,
      today,
      `${reasoning}；推荐每月存 ${formatMoneyPlain(balanced)}`,
      true,
    ),
  )

  const steady = Math.max(roundFriendly(capacity * 0.55), 5_000)
  add(
    makePlan(
      'steady',
      '稳妥',
      steady,
      remainingCents,
      today,
      `每月存 ${formatMoneyPlain(
        steady,
      )}，压力更小，同时留出应急空间`,
      true,
    ),
  )

  const fast = Math.max(
    roundFriendly(Math.min(freeMonthly, capacity * 1.6)),
    5_000,
  )
  add(
    makePlan(
      'fast',
      '加速',
      fast,
      remainingCents,
      today,
      `每月存 ${formatMoneyPlain(
        fast,
      )}，更快达成，但留给日常的余量更少`,
      true,
    ),
  )

  return plans
    .sort((left, right) => {
      const order: GoalPlanKey[] = ['deadline', 'balanced', 'steady', 'fast']
      return order.indexOf(left.key) - order.indexOf(right.key)
    })
    .slice(0, 4)
}

/** Average monthly surplus over the most recent complete months. */
export function averageMonthlySurplusCents(
  months: Array<{ incomeCents: number; expenseCents: number }>,
): number {
  if (months.length === 0) return 0
  const total = months.reduce(
    (sum, month) => sum + month.incomeCents - month.expenseCents,
    0,
  )
  return Math.max(Math.round(total / months.length), 0)
}
