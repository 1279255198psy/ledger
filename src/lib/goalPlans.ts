import type { GoalPlan } from '../types'
import { localDateKey } from './utils'

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

function planFor(
  key: GoalPlan['key'],
  label: string,
  monthlyCents: number,
  remainingCents: number,
  detail: string,
  today: string,
): GoalPlan {
  const months = Math.min(
    Math.max(Math.ceil(remainingCents / Math.max(monthlyCents, 1)), 1),
    600,
  )
  return {
    key,
    label,
    monthlyCents,
    months,
    finishMonth: addMonthsToKey(today, months),
    detail,
  }
}

/**
 * Suggests how much to put aside each month. The three tiers are anchored to
 * the recent average surplus; a target date, when present, gets its own
 * required-monthly plan.
 */
export function buildGoalPlans(
  remainingCents: number,
  monthlySurplusCents: number,
  targetDate: string | undefined,
  today = localDateKey(),
): GoalPlan[] {
  if (remainingCents <= 0) return []
  const plans: GoalPlan[] = []

  if (targetDate) {
    const months = monthsUntil(today, targetDate)
    const monthly = Math.ceil(remainingCents / months)
    plans.push(
      planFor(
        'deadline',
        '按目标日',
        monthly,
        remainingCents,
        `想在 ${targetDate} 前达成，按剩余月份平摊`,
        today,
      ),
    )
  }

  const surplus = Math.max(monthlySurplusCents, 0)
  if (surplus > 0) {
    const tiers: Array<{
      key: GoalPlan['key']
      label: string
      ratio: number
      detail: string
    }> = [
      {
        key: 'steady',
        label: '轻松',
        ratio: 0.3,
        detail: '只拿出月均结余的三成，压力较小',
      },
      {
        key: 'balanced',
        label: '平衡',
        ratio: 0.5,
        detail: '拿出一半月均结余，进度和日常开销兼顾',
      },
      {
        key: 'fast',
        label: '加速',
        ratio: 0.7,
        detail: '拿出七成月均结余，更快达成',
      },
    ]
    for (const tier of tiers) {
      const monthly = Math.max(Math.round(surplus * tier.ratio), 100)
      if (plans.some((plan) => plan.monthlyCents === monthly)) continue
      plans.push(
        planFor(
          tier.key,
          tier.label,
          monthly,
          remainingCents,
          tier.detail,
          today,
        ),
      )
    }
  }

  return plans
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
