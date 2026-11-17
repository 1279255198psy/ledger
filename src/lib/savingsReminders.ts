import type {
  SavingsHolding,
  SavingsReminderSettings,
} from '../types'
import {
  addDaysToKey,
  daysBetween,
  getSavingsSummary,
} from './savings'
import { formatMoney, localDateKey } from './utils'

export const SAVINGS_REMINDER_TITLE = '账页 · 储蓄到期提醒'
export const SAVINGS_REMINDER_CHANNEL = 'savings-reminders'

export const DEFAULT_SAVINGS_REMINDERS: SavingsReminderSettings = {
  enabled: false,
  time: '09:00',
}

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/

export function normalizeSavingsReminders(
  value: unknown,
): SavingsReminderSettings {
  if (!value || typeof value !== 'object') {
    return { ...DEFAULT_SAVINGS_REMINDERS }
  }
  const record = value as Record<string, unknown>
  return {
    enabled:
      typeof record.enabled === 'boolean'
        ? record.enabled
        : DEFAULT_SAVINGS_REMINDERS.enabled,
    time:
      typeof record.time === 'string' && TIME_PATTERN.test(record.time)
        ? record.time
        : DEFAULT_SAVINGS_REMINDERS.time,
  }
}

export function parseSavingsReminderTime(time: string): {
  hour: number
  minute: number
} {
  const match = TIME_PATTERN.exec(time)
  if (!match) return { hour: 9, minute: 0 }
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

export type SavingsMaturityKind = 'soon' | 'today'

export interface SavingsMaturityMilestone {
  key: string
  holdingId: string
  holdingName: string
  kind: SavingsMaturityKind
  fireDate: string
  maturityDate: string
  expectedMaturityCents: number
  title: string
  body: string
}

function bodyFor(
  holding: SavingsHolding,
  kind: SavingsMaturityKind,
): string {
  const summary = getSavingsSummary(holding)
  const amount = formatMoney(summary.expectedMaturityCents / 100)
  if (kind === 'today') {
    return `「${holding.name}」今天到期，预计本息 ${amount}。记得转存或转回流动资金。`
  }
  return `「${holding.name}」还有 3 天到期（${holding.maturityDate}），预计本息 ${amount}。`
}

/**
 * Every future milestone for open holdings. Android schedules these as
 * one-shot local notifications; the desktop scheduler works from the same
 * holding list but evaluates the date on each tick.
 */
export function buildSavingsMilestones(
  holdings: SavingsHolding[],
  fromDate = localDateKey(),
  limit = 60,
): SavingsMaturityMilestone[] {
  const milestones: SavingsMaturityMilestone[] = []
  for (const holding of holdings) {
    if (holding.closedAt || !holding.maturityDate) continue
    const summary = getSavingsSummary(holding)
    const soonDate = addDaysToKey(holding.maturityDate, -3)
    const dates: Array<{ kind: SavingsMaturityKind; date: string }> = []
    if (soonDate >= holding.startDate) {
      dates.push({ kind: 'soon', date: soonDate })
    }
    dates.push({ kind: 'today', date: holding.maturityDate })
    for (const milestone of dates) {
      if (milestone.date < fromDate) continue
      milestones.push({
        key: `savings:${holding.id}:${milestone.kind}`,
        holdingId: holding.id,
        holdingName: holding.name,
        kind: milestone.kind,
        fireDate: milestone.date,
        maturityDate: holding.maturityDate,
        expectedMaturityCents: summary.expectedMaturityCents,
        title: SAVINGS_REMINDER_TITLE,
        body: bodyFor(holding, milestone.kind),
      })
    }
  }
  return milestones
    .sort(
      (left, right) =>
        left.fireDate.localeCompare(right.fireDate) ||
        left.key.localeCompare(right.key),
    )
    .slice(0, limit)
}

/** Milestones that fall on `today`, used by the browser tick. */
export function savingsMilestonesDueToday(
  holdings: SavingsHolding[],
  today = localDateKey(),
): SavingsMaturityMilestone[] {
  return buildSavingsMilestones(holdings, today).filter(
    (milestone) => milestone.fireDate === today,
  )
}

export function daysUntilMilestone(
  milestone: SavingsMaturityMilestone,
  today = localDateKey(),
): number {
  return daysBetween(today, milestone.fireDate)
}
