import type {
  BudgetBook,
  CategoryBudgetStatus,
  DailyBudgetDay,
  DailyBudgetMode,
  DailyBudgetStatus,
  LedgerTransaction,
  MonthBudget,
  MonthBudgetMetrics,
  RangeBudget,
  RangeBudgetMetrics,
  ResolvedMonthBudget,
} from '../types'
import {
  getRootCategoryId,
  getTopLevelCategories,
} from './categories'
import { toPostings } from './allocations'
import {
  currentMonthKey,
  dateFromKey,
  daysInMonthOfKey,
  formatMoney,
  localDateKey,
} from './utils'

/** Fallback used until a month gets a plan of its own. */
export const DEFAULT_MONTHLY_BUDGET_CENTS = 800000

/** A custom range longer than this is almost certainly a typo. */
export const MAX_RANGE_DAYS = 366

/** Rough "over by" floor before a daily overrun turns into a warning: ¥20. */
const OVERRUN_FLOOR_CENTS = 2000
/** Daily allowance is "too tight" below half of the even split. */
const LOW_ALLOWANCE_RATIO = 0.5
/** Daily allowance is "too loose" above twice the even split. */
const HIGH_ALLOWANCE_RATIO = 2

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isMonthKey(value: unknown): value is string {
  return typeof value === 'string' && MONTH_PATTERN.test(value)
}

function formatDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** A real calendar day, not just a YYYY-MM-DD shaped string. */
export function isDateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_PATTERN.test(value)) return false
  return formatDateKey(dateFromKey(value)) === value
}

export function shiftDateKey(dateKey: string, days: number): string {
  if (!isDateKey(dateKey)) return dateKey
  const date = dateFromKey(dateKey)
  date.setDate(date.getDate() + days)
  return formatDateKey(date)
}

/**
 * Every calendar day in an inclusive range, in order. Invalid or reversed
 * ranges yield nothing; the walk is capped so corrupt data cannot stall the UI.
 */
export function eachDateInRange(
  startDate: string,
  endDate: string,
): string[] {
  if (!isDateKey(startDate) || !isDateKey(endDate) || startDate > endDate) {
    return []
  }
  const dates: string[] = []
  const cursor = dateFromKey(startDate)
  for (let index = 0; index <= MAX_RANGE_DAYS; index += 1) {
    const key = formatDateKey(cursor)
    if (key > endDate) break
    dates.push(key)
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

export function monthDateBounds(monthKey: string): {
  startDate: string
  endDate: string
} {
  const lastDay = String(daysInMonthOfKey(monthKey)).padStart(2, '0')
  return { startDate: `${monthKey}-01`, endDate: `${monthKey}-${lastDay}` }
}

/** True when any day of the range falls inside the month. */
export function rangeOverlapsMonth(
  range: Pick<RangeBudget, 'startDate' | 'endDate'>,
  monthKey: string,
): boolean {
  const { startDate, endDate } = monthDateBounds(monthKey)
  return range.startDate <= endDate && range.endDate >= startDate
}

export function newRangeBudgetId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return cryptoApi.randomUUID()
  }
  return `range-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`
}

export function makeDefaultBudget(monthKey: string): MonthBudget {
  return {
    month: monthKey,
    amountCents: DEFAULT_MONTHLY_BUDGET_CENTS,
    dailyMode: 'off',
  }
}

/**
 * A plan belongs to one month. Months without a plan inherit the closest
 * earlier plan so carrying a budget forward feels natural, but changing one
 * month never mutates another.
 */
export function resolveMonthBudget(
  book: BudgetBook,
  monthKey: string,
): ResolvedMonthBudget {
  const exact = book[monthKey]
  if (exact) return { budget: exact, source: 'set' }

  let inheritedKey: string | null = null
  for (const key of Object.keys(book)) {
    if (key < monthKey && (inheritedKey === null || key > inheritedKey)) {
      inheritedKey = key
    }
  }
  if (inheritedKey) {
    return {
      budget: { ...book[inheritedKey], month: monthKey },
      source: 'inherited',
      sourceMonth: inheritedKey,
    }
  }

  return { budget: makeDefaultBudget(monthKey), source: 'default' }
}

function normalizeDailyAmounts(
  value: unknown,
  monthKey: string,
): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const dayCount = daysInMonthOfKey(monthKey)
  const result: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value)) {
    const day = Number(key)
    if (
      !Number.isInteger(day) ||
      day < 1 ||
      day > dayCount ||
      typeof raw !== 'number' ||
      !Number.isInteger(raw) ||
      raw < 0
    ) {
      continue
    }
    result[String(day)] = raw
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeRangeDailyAmounts(
  value: unknown,
  dates: Set<string>,
): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const result: Record<string, number> = {}
  for (const [key, raw] of Object.entries(value)) {
    if (
      !dates.has(key) ||
      typeof raw !== 'number' ||
      !Number.isInteger(raw) ||
      raw < 0
    ) {
      continue
    }
    result[key] = raw
  }
  return Object.keys(result).length > 0 ? result : undefined
}

function normalizeCategoryBudgets(
  value: unknown,
): Record<string, number> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const allowed = new Set(
    getTopLevelCategories('expense').map((category) => category.id),
  )
  const result: Record<string, number> = {}
  for (const [categoryId, raw] of Object.entries(value)) {
    if (
      !allowed.has(categoryId) ||
      typeof raw !== 'number' ||
      !Number.isInteger(raw) ||
      raw < 0
    ) {
      continue
    }
    result[categoryId] = raw
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/** Normalizes one month's plan; null means the record cannot be trusted. */
export function normalizeMonthBudget(
  value: unknown,
  monthKey: string,
): MonthBudget | null {
  if (!isMonthKey(monthKey)) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const amountCents = record.amountCents
  if (
    typeof amountCents !== 'number' ||
    !Number.isInteger(amountCents) ||
    amountCents <= 0
  ) {
    return null
  }
  const dailyMode: DailyBudgetMode =
    record.dailyMode === 'auto' || record.dailyMode === 'manual'
      ? record.dailyMode
      : 'off'
  const dailyAmountsCents =
    dailyMode === 'manual'
      ? normalizeDailyAmounts(record.dailyAmountsCents, monthKey)
      : undefined
  const categoryBudgetsCents = normalizeCategoryBudgets(
    record.categoryBudgetsCents,
  )

  return {
    month: monthKey,
    amountCents,
    dailyMode,
    ...(dailyAmountsCents ? { dailyAmountsCents } : {}),
    ...(categoryBudgetsCents ? { categoryBudgetsCents } : {}),
  }
}

/**
 * Tolerant loader for local storage: invalid months are dropped so one bad
 * record cannot wipe a whole budget book. Returns null only when the shape
 * itself is unusable.
 */
export function normalizeBudgetBook(value: unknown): BudgetBook | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const book: BudgetBook = {}
  for (const [monthKey, raw] of Object.entries(value)) {
    if (!isMonthKey(monthKey)) continue
    const budget = normalizeMonthBudget(raw, monthKey)
    if (budget) book[monthKey] = budget
  }
  return book
}

/** Normalizes one custom range; null means the record cannot be trusted. */
export function normalizeRangeBudget(value: unknown): RangeBudget | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const startDate = record.startDate
  const endDate = record.endDate
  if (!isDateKey(startDate) || !isDateKey(endDate) || startDate > endDate) {
    return null
  }
  const dates = eachDateInRange(startDate, endDate)
  if (dates.length === 0 || dates.length > MAX_RANGE_DAYS) return null

  const amountCents = record.amountCents
  if (
    typeof amountCents !== 'number' ||
    !Number.isInteger(amountCents) ||
    amountCents <= 0
  ) {
    return null
  }
  const dailyMode: DailyBudgetMode =
    record.dailyMode === 'auto' || record.dailyMode === 'manual'
      ? record.dailyMode
      : 'off'
  const dailyAmountsCents =
    dailyMode === 'manual'
      ? normalizeRangeDailyAmounts(record.dailyAmountsCents, new Set(dates))
      : undefined
  const categoryBudgetsCents = normalizeCategoryBudgets(
    record.categoryBudgetsCents,
  )
  const id =
    typeof record.id === 'string' && record.id.trim()
      ? record.id
      : newRangeBudgetId()
  const name =
    typeof record.name === 'string' && record.name.trim()
      ? record.name.trim()
      : undefined

  return {
    id,
    ...(name ? { name } : {}),
    startDate,
    endDate,
    amountCents,
    dailyMode,
    ...(dailyAmountsCents ? { dailyAmountsCents } : {}),
    ...(categoryBudgetsCents ? { categoryBudgetsCents } : {}),
  }
}

/**
 * Tolerant loader for stored ranges: bad entries are dropped and duplicate ids
 * keep their first occurrence, so one broken range cannot hide the rest.
 */
export function normalizeRangeBudgets(value: unknown): RangeBudget[] | null {
  if (!Array.isArray(value)) return null
  const seen = new Set<string>()
  const ranges: RangeBudget[] = []
  for (const raw of value) {
    const range = normalizeRangeBudget(raw)
    if (!range || seen.has(range.id)) continue
    seen.add(range.id)
    ranges.push(range)
  }
  return ranges.sort(
    (left, right) =>
      left.startDate.localeCompare(right.startDate) ||
      left.endDate.localeCompare(right.endDate) ||
      left.id.localeCompare(right.id),
  )
}

/** Daily life spending keyed by date; project postings never land here. */
function getDailySpendByDate(
  transactions: LedgerTransaction[],
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const posting of toPostings(transactions)) {
    if (posting.kind !== 'expense' || posting.targetType !== 'daily') continue
    totals.set(posting.date, (totals.get(posting.date) ?? 0) + posting.signedCents)
  }
  return totals
}

/** Life spending per top-level category inside an inclusive date range. */
export function getDailyCategorySpendCents(
  transactions: LedgerTransaction[],
  startDate: string,
  endDate: string,
): Map<string, number> {
  const totals = new Map<string, number>()
  for (const posting of toPostings(transactions)) {
    if (
      posting.date < startDate ||
      posting.date > endDate ||
      posting.kind !== 'expense' ||
      posting.targetType !== 'daily'
    ) {
      continue
    }
    const rootId = getRootCategoryId(posting.categoryId)
    totals.set(rootId, (totals.get(rootId) ?? 0) + posting.signedCents)
  }
  return totals
}

interface DailyScopeInput {
  amountCents: number
  mode: DailyBudgetMode
  /** Consecutive calendar days, inclusive of both ends. */
  dates: string[]
  spentByDate: Map<string, number>
  manualCentsFor: (date: string, index: number) => number | undefined
  /** Today, clamped to the scope when it falls outside. */
  todayDate: string
}

/**
 * One continuous daily plan for a month or a custom range. Auto mode rolls the
 * remaining amount across every remaining day of the scope, so a range that
 * crosses a month boundary is never split into monthly chunks.
 */
function buildDailyStatus(input: DailyScopeInput): DailyBudgetStatus | null {
  if (input.mode === 'off') return null
  const dates = input.dates
  const dayCount = dates.length
  if (dayCount === 0) return null

  const baseDailyCents = Math.round(input.amountCents / dayCount)
  const firstDate = dates[0]
  const liveIndex = dates.indexOf(input.todayDate)
  const isLive = liveIndex >= 0
  const todayIndex = isLive
    ? liveIndex
    : input.todayDate < firstDate
      ? 0
      : dayCount - 1
  const today = todayIndex + 1
  const daysLeft = isLive
    ? dayCount - todayIndex
    : input.todayDate < firstDate
      ? dayCount
      : 0

  const days: DailyBudgetDay[] = []
  let spentBefore = 0
  let manualTotalCents = 0

  for (let index = 0; index < dayCount; index += 1) {
    const date = dates[index]
    const spentCents = input.spentByDate.get(date) ?? 0
    let budgetCents: number
    if (input.mode === 'manual') {
      budgetCents = input.manualCentsFor(date, index) ?? baseDailyCents
      manualTotalCents += budgetCents
    } else {
      const remainingDays = dayCount - index
      budgetCents = Math.max(
        0,
        Math.round((input.amountCents - spentBefore) / remainingDays),
      )
    }
    days.push({
      day: index + 1,
      date,
      budgetCents,
      spentCents,
      remainingCents: budgetCents - spentCents,
      autoAdjusted: input.mode === 'auto' && budgetCents !== baseDailyCents,
    })
    spentBefore += spentCents
  }

  const todayEntry = days[todayIndex]
  const todayBudgetCents = todayEntry?.budgetCents ?? 0
  const todaySpentCents = todayEntry?.spentCents ?? 0
  const overByCents = Math.max(0, todaySpentCents - todayBudgetCents)
  const overFloor = Math.max(
    OVERRUN_FLOOR_CENTS,
    Math.round(baseDailyCents * 0.5),
  )
  const overSeverity: DailyBudgetStatus['overSeverity'] =
    overByCents <= 0 ? 'none' : overByCents >= overFloor ? 'serious' : 'warn'

  let tomorrowBudgetCents: number | null = null
  if (isLive && todayIndex < dayCount - 1) {
    const spentThroughToday = dates
      .slice(0, todayIndex + 1)
      .reduce((sum, date) => sum + (input.spentByDate.get(date) ?? 0), 0)
    tomorrowBudgetCents = Math.max(
      0,
      Math.round(
        (input.amountCents - spentThroughToday) / (dayCount - todayIndex - 1),
      ),
    )
  }

  const scopeSpentCents = dates.reduce(
    (sum, date) => sum + (input.spentByDate.get(date) ?? 0),
    0,
  )
  const remainingCents = input.amountCents - scopeSpentCents
  const spentBeforeToday = dates
    .slice(0, todayIndex)
    .reduce((sum, date) => sum + (input.spentByDate.get(date) ?? 0), 0)
  const plannedFromTodayCents = days
    .slice(todayIndex)
    .reduce((sum, entry) => sum + entry.budgetCents, 0)
  const manualShortfallCents =
    input.mode === 'manual'
      ? Math.max(
          0,
          plannedFromTodayCents - (input.amountCents - spentBeforeToday),
        )
      : 0

  const checkingToday = isLive && daysLeft > 0
  const allowanceTooLow =
    checkingToday &&
    scopeSpentCents > 0 &&
    todayBudgetCents < baseDailyCents * LOW_ALLOWANCE_RATIO
  // A leftover-heavy allowance near the end is normal; only flag it while
  // there is still enough of the scope left to act on it.
  const allowanceTooHigh =
    checkingToday &&
    daysLeft >= 7 &&
    todayBudgetCents > baseDailyCents * HIGH_ALLOWANCE_RATIO

  return {
    mode: input.mode,
    days,
    baseDailyCents,
    today,
    todayDate: dates[todayIndex],
    isLive,
    todayBudgetCents,
    todaySpentCents,
    todayRemainingCents: todayBudgetCents - todaySpentCents,
    tomorrowBudgetCents,
    overToday: overByCents > 0,
    overSeverity,
    overByCents,
    manualTotalCents,
    manualMismatchCents:
      input.mode === 'manual'
        ? manualTotalCents - input.amountCents
        : 0,
    manualShortfallCents,
    allowanceTooLow,
    allowanceTooHigh,
    remainingCents,
    daysLeft,
  }
}

function buildMonthDailyStatus(
  budget: MonthBudget,
  monthKey: string,
  spentByDate: Map<string, number>,
): DailyBudgetStatus | null {
  const { startDate, endDate } = monthDateBounds(monthKey)
  const dates = eachDateInRange(startDate, endDate)
  return buildDailyStatus({
    amountCents: budget.amountCents,
    mode: budget.dailyMode,
    dates,
    spentByDate,
    manualCentsFor: (date) =>
      budget.dailyAmountsCents?.[String(Number(date.slice(8, 10)))],
    todayDate: localDateKey(),
  })
}

function buildCategoryStatuses(
  configured: Record<string, number> | undefined,
  spentByCategory: Map<string, number>,
): CategoryBudgetStatus[] {
  if (!configured) return []
  const categories = getTopLevelCategories('expense')
  const statuses: CategoryBudgetStatus[] = []
  for (const category of categories) {
    const budgetCents = configured[category.id]
    if (budgetCents === undefined) continue
    const spentCents = spentByCategory.get(category.id) ?? 0
    statuses.push({
      categoryId: category.id,
      category,
      budgetCents,
      spentCents,
      remainingCents: budgetCents - spentCents,
      // A zero cap with spending is already fully used, not zero progress.
      ratio:
        budgetCents > 0
          ? spentCents / budgetCents
          : spentCents > 0
            ? 1
            : 0,
    })
  }
  return statuses
}

function sumCategoryBudgets(categories: CategoryBudgetStatus[]): number {
  return categories.reduce((sum, entry) => sum + entry.budgetCents, 0)
}

/**
 * Everything the UI needs for one month: the resolved plan, monthly progress,
 * the daily rhythm, and per-category caps. Project spending is excluded
 * everywhere because it is accounted for on the project page.
 */
export function getMonthBudgetMetrics(
  transactions: LedgerTransaction[],
  monthKey: string,
  book: BudgetBook,
): MonthBudgetMetrics {
  const resolved = resolveMonthBudget(book, monthKey)
  const budget = resolved.budget
  const { startDate, endDate } = monthDateBounds(monthKey)
  const spentByDate = getDailySpendByDate(transactions)
  let spentCents = 0
  for (const date of eachDateInRange(startDate, endDate)) {
    spentCents += spentByDate.get(date) ?? 0
  }
  const remainingCents = budget.amountCents - spentCents
  const categories = buildCategoryStatuses(
    budget.categoryBudgetsCents,
    getDailyCategorySpendCents(transactions, startDate, endDate),
  )
  const categoryBudgetTotalCents = sumCategoryBudgets(categories)

  return {
    monthKey,
    amountCents: budget.amountCents,
    spentCents,
    remainingCents,
    ratio: budget.amountCents > 0 ? spentCents / budget.amountCents : 0,
    source: resolved.source,
    sourceMonth: resolved.sourceMonth,
    daily: buildMonthDailyStatus(budget, monthKey, spentByDate),
    categories,
    categoryBudgetTotalCents,
    unallocatedCents: budget.amountCents - categoryBudgetTotalCents,
    overBudget: remainingCents < 0,
  }
}

/**
 * A custom range is scored exactly like a month, over its own dates. Days that
 * cross a month boundary stay in one plan: only the daily amounts are expected
 * to add up to the range amount, never the months.
 */
export function getRangeBudgetMetrics(
  transactions: LedgerTransaction[],
  range: RangeBudget,
  todayDate = localDateKey(),
): RangeBudgetMetrics {
  const dates = eachDateInRange(range.startDate, range.endDate)
  const dayCount = dates.length
  const spentByDate = getDailySpendByDate(transactions)
  let spentCents = 0
  for (const date of dates) {
    spentCents += spentByDate.get(date) ?? 0
  }

  const started = dayCount > 0 && todayDate >= range.startDate
  const ended = dayCount > 0 && todayDate > range.endDate
  const active = started && !ended
  const elapsedDays = !started ? 0 : ended ? dayCount : dates.indexOf(todayDate) + 1
  const daysLeft = !started
    ? dayCount
    : ended
      ? 0
      : dayCount - elapsedDays + 1

  const remainingCents = range.amountCents - spentCents
  const categories = buildCategoryStatuses(
    range.categoryBudgetsCents,
    getDailyCategorySpendCents(transactions, range.startDate, range.endDate),
  )
  const categoryBudgetTotalCents = sumCategoryBudgets(categories)

  return {
    range,
    startDate: range.startDate,
    endDate: range.endDate,
    dayCount,
    amountCents: range.amountCents,
    spentCents,
    remainingCents,
    ratio: range.amountCents > 0 ? spentCents / range.amountCents : 0,
    active,
    elapsedDays,
    daysLeft,
    daily: buildDailyStatus({
      amountCents: range.amountCents,
      mode: range.dailyMode,
      dates,
      spentByDate,
      manualCentsFor: (date) => range.dailyAmountsCents?.[date],
      todayDate,
    }),
    categories,
    categoryBudgetTotalCents,
    unallocatedCents: range.amountCents - categoryBudgetTotalCents,
    overBudget: remainingCents < 0,
  }
}

export interface BudgetWarning {
  kind: 'daily-over' | 'daily-low' | 'daily-high' | 'manual-mismatch'
  tone: 'info' | 'warn' | 'danger'
  title: string
  detail: string
}

interface WarningCopy {
  /** 月预算 / 区间预算 */
  budget: string
  /** 本月 / 本区间 */
  scope: string
  /** 月均分 / 区间均分 */
  split: string
  /** 月底 / 区间结束 */
  tail: string
}

const MONTH_COPY: WarningCopy = {
  budget: '月预算',
  scope: '本月',
  split: '月均分',
  tail: '月底',
}

const RANGE_COPY: WarningCopy = {
  budget: '区间预算',
  scope: '本区间',
  split: '区间均分',
  tail: '区间结束',
}

function collectBudgetWarnings(
  daily: DailyBudgetStatus | null,
  remainingCents: number,
  live: boolean,
  copy: WarningCopy,
): BudgetWarning[] {
  if (!daily) return []
  const warnings: BudgetWarning[] = []

  // "Today" only makes sense while the scope is running; past scopes keep
  // their daily history visible without raising a live overrun warning.
  if (live && daily.overToday && daily.overSeverity !== 'none') {
    const serial = daily.overSeverity === 'serious' ? '已经超出较多' : '超出'
    warnings.push({
      kind: 'daily-over',
      tone: daily.overSeverity === 'serious' ? 'danger' : 'warn',
      title: `今日${serial}每日预算`,
      detail:
        daily.mode === 'auto' && daily.tomorrowBudgetCents !== null
          ? `超出 ${formatMoney(daily.overByCents / 100)}。明天额度已自动调整为 ${formatMoney(daily.tomorrowBudgetCents / 100)}。`
          : daily.mode === 'manual'
            ? `超出 ${formatMoney(daily.overByCents / 100)}。手动额度不会被改动，可在预算设置中重排剩余天数。`
            : `超出 ${formatMoney(daily.overByCents / 100)}。`,
    })
  }

  if (daily.allowanceTooLow) {
    warnings.push({
      kind: 'daily-low',
      tone: 'warn',
      title: '每日预算已经偏低',
      detail:
        daily.mode === 'auto'
          ? `按剩余余额均摊后，今天只剩很少的额度。可以上调${copy.budget}，或减少后续支出。`
          : `手动每日额度已经低于${copy.budget}的一半均摊，建议调整${copy.budget}或重排每日额度。`,
    })
  } else if (daily.allowanceTooHigh) {
    warnings.push({
      kind: 'daily-high',
      tone: 'info',
      title: '每日预算偏宽松',
      detail:
        daily.mode === 'auto'
          ? `${copy.scope}结余较多，按剩余天数均摊后今日额度已超过${copy.split}的两倍。如果是有意节省，可以忽略；若预算本身偏高，可适当下调${copy.budget}。`
          : `今日手动额度超过${copy.split}的两倍，后续日期可能会不够用。可以下调今日额度，或用「按剩余重排」重新分配。`,
    })
  }

  if (
    daily.mode === 'manual' &&
    daily.manualMismatchCents !== 0 &&
    remainingCents > 0
  ) {
    warnings.push({
      kind: 'manual-mismatch',
      tone: 'info',
      title: `每日合计与${copy.budget}不一致`,
      detail: `每日额度合计 ${formatMoney(daily.manualTotalCents / 100)}，与${copy.budget}相差 ${formatMoney(Math.abs(daily.manualMismatchCents) / 100)}。可在预算设置中一键同步。`,
    })
  }

  if (daily.mode === 'manual' && daily.manualShortfallCents > 0 && live) {
    warnings.push({
      kind: 'manual-mismatch',
      tone: 'warn',
      title: `后续每日额度将超出${copy.budget}`,
      detail: `按现有每日额度，${copy.tail}会多出 ${formatMoney(daily.manualShortfallCents / 100)}。可以重排剩余每日额度，或上调${copy.budget}。`,
    })
  }

  return warnings
}

/** Shared wording and tone so every budget surface sounds like one app. */
export function getBudgetWarnings(
  metrics: MonthBudgetMetrics,
): BudgetWarning[] {
  return collectBudgetWarnings(
    metrics.daily,
    metrics.remainingCents,
    metrics.monthKey === currentMonthKey(),
    MONTH_COPY,
  )
}

export function getRangeBudgetWarnings(
  metrics: RangeBudgetMetrics,
): BudgetWarning[] {
  return collectBudgetWarnings(
    metrics.daily,
    metrics.remainingCents,
    metrics.active,
    RANGE_COPY,
  )
}
