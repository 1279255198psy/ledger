import type {
  Account,
  AllocationLine,
  Category,
  LedgerTransaction,
  Project,
  RecurringFrequency,
  RecurringPending,
  RecurringRule,
  RecurringTemplate,
  SpendingNature,
  TransactionType,
} from '../types'
import {
  detachProjectAllocations,
  scaleAllocations,
  sumAllocationCents,
} from './allocations'
import { getDefaultAccountId } from './accounts'
import { isValidAllocation } from './data'
import { localDateKey } from './utils'

const DAY_MS = 24 * 60 * 60 * 1000
const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六']

/**
 * Never generate more than a year of history for one rule. A daily rule with a
 * start date years in the past would otherwise flood the ledger on first open.
 */
const LOOKBACK_DAYS = 366
/** The most recent due periods kept when a rule is far behind. */
const MAX_OCCURRENCES_PER_RUN = 120
/** Safety valve for the occurrence walkers. */
const MAX_WALK = 1000

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

interface DateParts {
  year: number
  month: number
  day: number
}

function parseDateKey(dateKey: string): DateParts {
  const [year, month, day] = dateKey.split('-').map(Number)
  return { year, month, day }
}

export function formatDateKey(
  year: number,
  month: number,
  day: number,
): string {
  return `${year}-${pad(month)}-${pad(day)}`
}

function daysInMonth(year: number, month: number): number {
  // Date.UTC treats month as 0-based, so passing the 1-based month with day 0
  // gives the last day of that month.
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function dayNumber(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey)
  return Date.UTC(year, month - 1, day) / DAY_MS
}

export function addDays(dateKey: string, days: number): string {
  const { year, month, day } = parseDateKey(dateKey)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return formatDateKey(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate(),
  )
}

export function diffDays(from: string, to: string): number {
  return dayNumber(to) - dayNumber(from)
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayNumber(dateKey: string): number {
  const { year, month, day } = parseDateKey(dateKey)
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

function clampToMonth(year: number, month: number, day: number): string {
  return formatDateKey(
    year,
    month,
    Math.min(day, daysInMonth(year, month)),
  )
}

/**
 * First occurrence on or after both the rule start and the target date.
 * Monthly and yearly days are clamped to the month's last day, which is what
 * makes「每月 31 号」land on Feb 28/29.
 */
export function firstOccurrenceOnOrAfter(
  frequency: RecurringFrequency,
  startDate: string,
  targetDate: string,
): string | null {
  const target = targetDate > startDate ? targetDate : startDate

  if (frequency.kind === 'interval') {
    const gap = diffDays(startDate, target)
    if (gap <= 0) return startDate
    const steps = Math.ceil(gap / frequency.days)
    return addDays(startDate, steps * frequency.days)
  }

  if (frequency.kind === 'weekly') {
    const first = addDays(
      startDate,
      (frequency.weekday - weekdayNumber(startDate) + 7) % 7,
    )
    if (first >= target) return first
    const weeks = Math.ceil(diffDays(first, target) / 7)
    return addDays(first, weeks * 7)
  }

  if (frequency.kind === 'monthly') {
    const targetParts = parseDateKey(target)
    let year = targetParts.year
    let month = targetParts.month
    for (let index = 0; index < MAX_WALK; index += 1) {
      const candidate = clampToMonth(year, month, frequency.day)
      if (candidate >= startDate && candidate >= target) return candidate
      month += 1
      if (month > 12) {
        month = 1
        year += 1
      }
    }
    return null
  }

  const targetParts = parseDateKey(target)
  for (
    let year = targetParts.year;
    year < targetParts.year + 400;
    year += 1
  ) {
    const candidate = clampToMonth(year, frequency.month, frequency.day)
    if (candidate >= startDate && candidate >= target) return candidate
  }
  return null
}

export function nextOccurrenceAfter(
  frequency: RecurringFrequency,
  startDate: string,
  afterDate: string,
): string | null {
  return firstOccurrenceOnOrAfter(
    frequency,
    startDate,
    addDays(afterDate, 1),
  )
}

/** The next few dates, used by the form preview. */
export function previewOccurrences(
  frequency: RecurringFrequency,
  startDate: string,
  count = 3,
  endDate?: string,
): string[] {
  const dates: string[] = []
  let cursor = firstOccurrenceOnOrAfter(frequency, startDate, startDate)
  while (cursor && dates.length < count) {
    if (endDate && cursor > endDate) break
    dates.push(cursor)
    cursor = nextOccurrenceAfter(frequency, startDate, cursor)
  }
  return dates
}

/**
 * Due periods from the rule's cursor through `today`, capped to the most
 * recent ones. Periods older than the lookback window are intentionally
 * skipped so a mistyped start date cannot dump years of history at once.
 */
export function dueDatesForRule(
  rule: RecurringRule,
  today = localDateKey(),
): string[] {
  if (!rule.enabled) return []

  let lower = rule.generatedThrough
    ? addDays(rule.generatedThrough, 1)
    : rule.startDate
  const lookback = addDays(today, -LOOKBACK_DAYS)
  if (lower < lookback) lower = lookback

  let upper = today
  if (rule.endDate && rule.endDate < upper) upper = rule.endDate
  if (lower > upper) return []

  const dates: string[] = []
  let cursor = firstOccurrenceOnOrAfter(
    rule.frequency,
    rule.startDate,
    lower,
  )
  while (cursor && cursor <= upper && dates.length < MAX_WALK) {
    dates.push(cursor)
    cursor = nextOccurrenceAfter(
      rule.frequency,
      rule.startDate,
      cursor,
    )
  }

  return dates.length > MAX_OCCURRENCES_PER_RUN
    ? dates.slice(-MAX_OCCURRENCES_PER_RUN)
    : dates
}

/** The next period that has not been generated yet, for lists and previews. */
export function nextDueDate(rule: RecurringRule): string | null {
  const after = rule.generatedThrough
    ? rule.generatedThrough
    : addDays(rule.startDate, -1)
  const next = firstOccurrenceOnOrAfter(
    rule.frequency,
    rule.startDate,
    addDays(after, 1),
  )
  if (!next) return null
  if (rule.endDate && next > rule.endDate) return null
  return next
}

export function describeFrequency(frequency: RecurringFrequency): string {
  switch (frequency.kind) {
    case 'monthly':
      return `每月 ${frequency.day} 号`
    case 'weekly':
      return `每周${WEEKDAY_SHORT[frequency.weekday]}`
    case 'yearly':
      return `每年 ${frequency.month} 月 ${frequency.day} 日`
    default:
      return `每隔 ${frequency.days} 天`
  }
}

export function formatRecurringDate(
  dateKey: string,
  today = localDateKey(),
): string {
  const { year, month, day } = parseDateKey(dateKey)
  if (year !== parseDateKey(today).year) {
    return `${year}年${month}月${day}日`
  }
  return `${month}月${day}日`
}

export function newRecurringRuleId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `rule-${crypto.randomUUID()}`
  }
  return `rule-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/** Deterministic ids are the cross-device duplicate guard. */
export function recurringTransactionId(
  ruleId: string,
  date: string,
): string {
  return `recurring:${ruleId}:${date}`
}

export function recurringPendingId(ruleId: string, date: string): string {
  return `rp:${ruleId}:${date}`
}

function isIntegerInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= max
  )
}

export function isValidRecurringFrequency(
  value: unknown,
): value is RecurringFrequency {
  if (!value || typeof value !== 'object') return false
  const item = value as Record<string, unknown>
  switch (item.kind) {
    case 'monthly':
      return isIntegerInRange(item.day, 1, 31)
    case 'weekly':
      return isIntegerInRange(item.weekday, 0, 6)
    case 'yearly':
      return (
        isIntegerInRange(item.month, 1, 12) &&
        isIntegerInRange(item.day, 1, 31)
      )
    case 'interval':
      return isIntegerInRange(item.days, 1, 366)
    default:
      return false
  }
}

function normalizeTemplate(
  value: unknown,
  categories: Category[],
): RecurringTemplate | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (item.type !== 'expense' && item.type !== 'income') return null
  const type: TransactionType = item.type

  if (
    typeof item.amountCents !== 'number' ||
    !Number.isInteger(item.amountCents) ||
    item.amountCents <= 0
  ) {
    return null
  }
  if (
    typeof item.categoryId !== 'string' ||
    item.categoryId.length === 0 ||
    item.categoryId.length > 120
  ) {
    return null
  }
  const knownCategory = categories.find(
    (category) => category.id === item.categoryId,
  )
  if (knownCategory && knownCategory.type !== type) return null

  if (
    typeof item.accountId !== 'string' ||
    item.accountId.length === 0 ||
    item.accountId.length > 80
  ) {
    return null
  }
  if (typeof item.note !== 'string' || item.note.length > 200) return null
  if (
    item.spendingNature !== undefined &&
    item.spendingNature !== 'essential' &&
    item.spendingNature !== 'flexible'
  ) {
    return null
  }
  if (!Array.isArray(item.allocations) || item.allocations.length === 0) {
    return null
  }
  if (!item.allocations.every(isValidAllocation)) return null
  if (
    sumAllocationCents(item.allocations as AllocationLine[]) !==
    item.amountCents
  ) {
    return null
  }

  return {
    type,
    amountCents: item.amountCents,
    categoryId: item.categoryId,
    accountId: item.accountId,
    note: item.note,
    ...(item.spendingNature
      ? { spendingNature: item.spendingNature as SpendingNature }
      : {}),
    allocations: item.allocations as AllocationLine[],
  }
}

export function normalizeRecurringRule(
  value: unknown,
  categories: Category[],
): RecurringRule | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>

  if (
    typeof item.id !== 'string' ||
    item.id.length === 0 ||
    item.id.length > 120 ||
    (item.schemaVersion !== undefined && item.schemaVersion !== 1) ||
    typeof item.enabled !== 'boolean' ||
    typeof item.startDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(item.startDate) ||
    (item.endDate !== undefined &&
      (typeof item.endDate !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.endDate) ||
        item.endDate < item.startDate)) ||
    (item.mode !== 'auto' && item.mode !== 'confirm') ||
    (item.generatedThrough !== undefined &&
      (typeof item.generatedThrough !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}$/.test(item.generatedThrough))) ||
    (item.stoppedAt !== undefined &&
      typeof item.stoppedAt !== 'string') ||
    typeof item.createdAt !== 'string' ||
    typeof item.updatedAt !== 'string'
  ) {
    return null
  }

  const template = normalizeTemplate(item.template, categories)
  if (!template) return null
  if (!isValidRecurringFrequency(item.frequency)) return null

  return {
    id: item.id,
    schemaVersion: 1,
    enabled: item.enabled,
    template,
    frequency: item.frequency,
    startDate: item.startDate,
    ...(item.endDate ? { endDate: item.endDate } : {}),
    mode: item.mode,
    ...(item.generatedThrough
      ? { generatedThrough: item.generatedThrough }
      : {}),
    ...(item.stoppedAt ? { stoppedAt: item.stoppedAt } : {}),
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
  }
}

export function normalizeRecurringRules(
  value: unknown,
  categories: Category[],
): RecurringRule[] | null {
  if (!Array.isArray(value)) return null
  const ids = new Set<string>()
  const rules: RecurringRule[] = []
  for (const entry of value) {
    const rule = normalizeRecurringRule(entry, categories)
    if (!rule || ids.has(rule.id)) continue
    ids.add(rule.id)
    rules.push(rule)
  }
  return rules
}

export function normalizeRecurringPending(
  value: unknown,
  categories: Category[],
  ruleIds?: ReadonlySet<string>,
): RecurringPending | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>

  if (
    typeof item.ruleId !== 'string' ||
    item.ruleId.length === 0 ||
    item.ruleId.length > 120 ||
    (ruleIds && !ruleIds.has(item.ruleId)) ||
    typeof item.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(item.date)
  ) {
    return null
  }

  const template = normalizeTemplate(item.template, categories)
  if (!template) return null

  return {
    id: recurringPendingId(item.ruleId, item.date),
    ruleId: item.ruleId,
    date: item.date,
    template,
    createdAt:
      typeof item.createdAt === 'string'
        ? item.createdAt
        : `${item.date}T00:00:00.000Z`,
  }
}

export function normalizeRecurringPendings(
  value: unknown,
  categories: Category[],
  ruleIds?: ReadonlySet<string>,
): RecurringPending[] | null {
  if (!Array.isArray(value)) return null
  const ids = new Set<string>()
  const pending: RecurringPending[] = []
  for (const entry of value) {
    const item = normalizeRecurringPending(entry, categories, ruleIds)
    if (!item || ids.has(item.id)) continue
    ids.add(item.id)
    pending.push(item)
  }
  return pending
}

function cloneTemplate(template: RecurringTemplate): RecurringTemplate {
  return {
    ...template,
    allocations: template.allocations.map((line) => ({ ...line })),
  }
}

/**
 * Repairs a template just before it is used: a deleted category falls back to
 * the matching default, a deleted card to the default wallet, and project
 * allocations whose project is gone rejoin the daily bucket.
 */
export function resolveTemplate(
  template: RecurringTemplate,
  categories: Category[],
  accounts: Account[],
  projects: Project[],
): RecurringTemplate {
  const category =
    categories.find(
      (item) =>
        item.id === template.categoryId && item.type === template.type,
    ) ??
    categories.find(
      (item) =>
        item.id ===
          (template.type === 'expense' ? 'other_expense' : 'other_income') &&
        item.type === template.type,
    ) ??
    categories.find(
      (item) => item.type === template.type && !item.parentId,
    ) ??
    categories.find((item) => item.type === template.type)

  const accountId = accounts.some(
    (account) => account.id === template.accountId,
  )
    ? template.accountId
    : getDefaultAccountId(accounts)

  const projectIds = new Set(projects.map((project) => project.id))
  let allocations = template.allocations.map((line) => ({ ...line }))
  for (const line of [...allocations]) {
    if (
      line.targetType === 'project' &&
      line.projectId &&
      !projectIds.has(line.projectId)
    ) {
      allocations = detachProjectAllocations(allocations, line.projectId)
    }
  }
  if (sumAllocationCents(allocations) !== template.amountCents) {
    allocations = scaleAllocations(allocations, template.amountCents)
  }

  return {
    ...template,
    categoryId: category?.id ?? template.categoryId,
    accountId,
    allocations,
  }
}

export function transactionFromTemplate(
  ruleId: string,
  date: string,
  template: RecurringTemplate,
): LedgerTransaction {
  const id = recurringTransactionId(ruleId, date)
  return {
    id,
    schemaVersion: 2,
    type: template.type,
    amountCents: template.amountCents,
    categoryId: template.categoryId,
    accountId: template.accountId,
    date,
    note: template.note,
    ...(template.type === 'expense' && template.spendingNature
      ? { spendingNature: template.spendingNature }
      : {}),
    allocations: template.allocations.map((line, index) => ({
      ...line,
      id: `${id}-al-${index + 1}`,
    })),
    createdAt: `${date}T00:00:00.000Z`,
    recurringRuleId: ruleId,
    recurringPeriod: date,
  }
}

export interface RecurringCatchUpInput {
  rules: RecurringRule[]
  transactions: LedgerTransaction[]
  pending: RecurringPending[]
  categories: Category[]
  accounts: Account[]
  projects: Project[]
  today?: string
}

export interface RecurringCatchUpResult {
  rules: RecurringRule[]
  newTransactions: LedgerTransaction[]
  newPendings: RecurringPending[]
  changed: boolean
}

/**
 * Pure catch-up planner. It only returns due periods, never future ones, and
 * every generated id is deterministic so running it twice (or on two devices)
 * converges on the same records.
 */
export function planRecurringCatchUp(
  input: RecurringCatchUpInput,
): RecurringCatchUpResult {
  const today = input.today ?? localDateKey()
  const transactionIds = new Set(
    input.transactions.map((item) => item.id),
  )
  const pendingIds = new Set(input.pending.map((item) => item.id))
  const newTransactions: LedgerTransaction[] = []
  const newPendings: RecurringPending[] = []
  let changed = false

  const rules = input.rules.map((rule) => {
    if (!rule.enabled) return rule
    const dates = dueDatesForRule(rule, today)
    if (dates.length === 0) return rule

    const template = resolveTemplate(
      rule.template,
      input.categories,
      input.accounts,
      input.projects,
    )

    for (const date of dates) {
      const txnId = recurringTransactionId(rule.id, date)
      const pendingId = recurringPendingId(rule.id, date)

      if (rule.mode === 'auto') {
        // A period already waiting for confirmation is left to the user; it
        // must not be recorded twice.
        if (transactionIds.has(txnId) || pendingIds.has(pendingId)) continue
        transactionIds.add(txnId)
        newTransactions.push(
          transactionFromTemplate(rule.id, date, template),
        )
      } else {
        if (pendingIds.has(pendingId) || transactionIds.has(txnId)) continue
        pendingIds.add(pendingId)
        newPendings.push({
          id: pendingId,
          ruleId: rule.id,
          date,
          template: cloneTemplate(template),
          createdAt: `${date}T00:00:00.000Z`,
        })
      }
    }

    const last = dates[dates.length - 1]
    if (rule.generatedThrough === last) return rule
    changed = true
    return { ...rule, generatedThrough: last }
  })

  return {
    rules,
    newTransactions,
    newPendings,
    changed: changed || newTransactions.length > 0 || newPendings.length > 0,
  }
}

/** Keeps the schedule anchored to the date the user just edited. */
export function reanchorFrequency(
  frequency: RecurringFrequency,
  dateKey: string,
): RecurringFrequency {
  const { month, day } = parseDateKey(dateKey)
  switch (frequency.kind) {
    case 'monthly':
      return { kind: 'monthly', day }
    case 'weekly':
      return { kind: 'weekly', weekday: weekdayNumber(dateKey) }
    case 'yearly':
      return { kind: 'yearly', month, day }
    default:
      return frequency
  }
}
