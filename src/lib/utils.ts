import { getAccount } from './accounts'
import {
  getCategoriesForType,
  getCategory,
  getCategoryPathName,
  getRootCategoryId,
} from './categories'
import { toPostings } from './allocations'
import {
  expenseDeltaCents,
  isRefund,
  transactionKindLabel,
} from './refunds'
import { activeCurrencySymbol } from './currency'
import type {
  CategoryTotal,
  DailyDatum,
  LedgerTransaction,
  MonthDatum,
  MonthPairDatum,
  MonthTotals,
  Project,
  TransactionType,
} from '../types'

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function toDateParts(dateKey: string): {
  year: number
  month: number
  day: number
} {
  const [year, month, day] = dateKey.split('-').map(Number)
  return { year, month, day }
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function currentMonthKey(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

export function monthOfDateKey(dateKey: string): string {
  return dateKey.slice(0, 7)
}

export function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

export function monthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number)
  return `${year}年${month}月`
}

export function monthShortLabel(monthKey: string): string {
  const [, month] = monthKey.split('-').map(Number)
  return `${month}月`
}

export function daysInMonthOfKey(monthKey: string): number {
  const [year, month] = monthKey.split('-').map(Number)
  return new Date(year, month, 0).getDate()
}

export function isCurrentMonth(monthKey: string): boolean {
  return monthKey === currentMonthKey()
}

export function dateFromKey(dateKey: string): Date {
  const { year, month, day } = toDateParts(dateKey)
  return new Date(year, month - 1, day)
}

export function weekdayOfDateKey(dateKey: string): string {
  return WEEKDAYS[dateFromKey(dateKey).getDay()]
}

export function formatDayHeading(dateKey: string): string {
  const { month, day } = toDateParts(dateKey)
  return `${month}月${day}日 · ${weekdayOfDateKey(dateKey)}`
}

export function formatShortDate(dateKey: string): string {
  const { month, day } = toDateParts(dateKey)
  return `${month}月${day}日`
}

export function formatFullDate(date = new Date()): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 · ${WEEKDAYS[date.getDay()]}`
}

export function defaultDateForMonth(monthKey: string): string {
  const today = new Date()
  if (monthKey === currentMonthKey(today)) return localDateKey(today)
  if (monthKey < currentMonthKey(today)) {
    return `${monthKey}-${pad(daysInMonthOfKey(monthKey))}`
  }
  return `${monthKey}-01`
}

export function getMonthTransactions(
  transactions: LedgerTransaction[],
  monthKey: string,
): LedgerTransaction[] {
  return transactions.filter((item) => item.date.startsWith(`${monthKey}-`))
}

export function sumAmounts(transactions: LedgerTransaction[]): number {
  return (
    transactions.reduce((sum, item) => sum + item.amountCents, 0) / 100
  )
}

export function getTotals(transactions: LedgerTransaction[]): MonthTotals {
  let incomeCents = 0
  let expenseCents = 0
  for (const item of transactions) {
    if (item.type === 'income') incomeCents += item.amountCents
    // Refunds subtract here, so they never inflate income.
    else expenseCents += expenseDeltaCents(item)
  }
  return {
    income: incomeCents / 100,
    expense: expenseCents / 100,
    balance: (incomeCents - expenseCents) / 100,
  }
}

export function getCategoryTotals(
  transactions: LedgerTransaction[],
  type: TransactionType = 'expense',
): CategoryTotal[] {
  const filtered = transactions.filter((item) => item.type === type)
  const deltaOf = (item: LedgerTransaction) =>
    type === 'expense' ? expenseDeltaCents(item) : item.amountCents
  const totalCents = filtered.reduce((sum, item) => sum + deltaOf(item), 0)
  // Subcategory spending rolls up into its top-level category so charts and
  // monthly totals stay at the level people budget at.
  const grouped = new Map<string, number>()
  for (const item of filtered) {
    const rootId = getRootCategoryId(item.categoryId)
    grouped.set(rootId, (grouped.get(rootId) ?? 0) + deltaOf(item))
  }

  return [...grouped.entries()]
    // A category refunded past what it spent nets negative; a chart cannot
    // show that, and the money is off the books for the month anyway.
    .filter(([, valueCents]) => type !== 'expense' || valueCents > 0)
    .map(([id, valueCents]) => ({
      category: getCategory(id, type),
      value: valueCents / 100,
      share: totalCents > 0 ? valueCents / totalCents : 0,
    }))
    .sort((a, b) => b.value - a.value)
}

/**
 * Spending inside one top-level category, split by the subcategory it was
 * filed under. A transaction booked on the parent itself comes back with the
 * parent's category and its own value, so the rows always add up to the
 * top-level total. `share` here is relative to that top-level category.
 */
export function getSubcategoryTotals(
  transactions: LedgerTransaction[],
  rootId: string,
  type: TransactionType = 'expense',
): CategoryTotal[] {
  const deltaOf = (item: LedgerTransaction) =>
    type === 'expense' ? expenseDeltaCents(item) : item.amountCents
  const filtered = transactions.filter(
    (item) =>
      item.type === type && getRootCategoryId(item.categoryId) === rootId,
  )
  const totalCents = filtered.reduce((sum, item) => sum + deltaOf(item), 0)
  const grouped = new Map<string, number>()
  for (const item of filtered) {
    grouped.set(
      item.categoryId,
      (grouped.get(item.categoryId) ?? 0) + deltaOf(item),
    )
  }

  return [...grouped.entries()]
    // A subcategory refunded past what it spent nets negative; it still has
    // to stay in the list so the rows keep adding up to the parent total.
    .filter(([, valueCents]) => valueCents !== 0)
    .map(([id, valueCents]) => ({
      category: getCategory(id, type),
      value: valueCents / 100,
      share: totalCents > 0 ? valueCents / totalCents : 0,
    }))
    .sort((a, b) => b.value - a.value)
}

export function buildMonthSeries(
  transactions: LedgerTransaction[],
  endMonth: string,
  count = 6,
  type: TransactionType = 'expense',
): MonthDatum[] {
  const months: MonthDatum[] = []
  for (let i = count - 1; i >= 0; i -= 1) {
    const key = shiftMonth(endMonth, -i)
    const value =
      getMonthTransactions(transactions, key)
        .filter((item) => item.type === type)
        .reduce(
          (sum, item) =>
            sum +
            (type === 'expense' ? expenseDeltaCents(item) : item.amountCents),
          0,
        ) / 100
    months.push({ key, label: monthShortLabel(key), value })
  }
  return months
}

export function buildMonthPairSeries(
  transactions: LedgerTransaction[],
  endMonth: string,
  count = 6,
): MonthPairDatum[] {
  const months: MonthPairDatum[] = []
  for (let i = count - 1; i >= 0; i -= 1) {
    const key = shiftMonth(endMonth, -i)
    const totals = getTotals(getMonthTransactions(transactions, key))
    months.push({
      key,
      label: monthShortLabel(key),
      income: totals.income,
      expense: totals.expense,
    })
  }
  return months
}

export function buildDailyExpenses(
  transactions: LedgerTransaction[],
  monthKey: string,
  target: 'all' | 'daily' = 'all',
  countedProjectIds?: ReadonlySet<string>,
): DailyDatum[] {
  const dayCount = daysInMonthOfKey(monthKey)
  const values = new Array<number>(dayCount + 1).fill(0)
  for (const posting of toPostings(transactions, countedProjectIds)) {
    if (posting.month !== monthKey || posting.kind !== 'expense') continue
    if (target === 'daily' && !posting.countsAsDaily) continue
    const day = Number(posting.date.slice(8, 10))
    values[day] += posting.signedCents / 100
  }
  return Array.from({ length: dayCount }, (_, index) => ({
    day: index + 1,
    value: values[index + 1],
  }))
}

export function percentChange(
  current: number,
  previous: number,
): number | null {
  if (previous === 0) return current === 0 ? 0 : null
  return ((current - previous) / previous) * 100
}

export function daysElapsedInMonth(monthKey: string): number {
  const now = new Date()
  const current = currentMonthKey(now)
  if (monthKey === current) return now.getDate()
  if (monthKey < current) return daysInMonthOfKey(monthKey)
  return 0
}

export function projectMonthlySpend(
  expense: number,
  monthKey: string,
): number {
  const elapsed = daysElapsedInMonth(monthKey)
  if (elapsed <= 0) return 0
  return (expense / elapsed) * daysInMonthOfKey(monthKey)
}

/** Last day a project counts as running; an open-ended project never ends. */
export function projectLastDate(project: Project): string {
  if (project.endDate) return project.endDate
  if (project.archivedAt) return project.archivedAt.slice(0, 10)
  if (project.status === 'closed') return project.updatedAt.slice(0, 10)
  return '9999-12-31'
}

export function projectCoversDate(project: Project, dateKey: string): boolean {
  return dateKey >= project.startDate && dateKey <= projectLastDate(project)
}

/** Whether the project's start/end range overlaps any day of the month. */
export function projectCoversMonth(
  project: Project,
  monthKey: string,
): boolean {
  const monthStart = `${monthKey}-01`
  const monthEnd = `${monthKey}-${pad(daysInMonthOfKey(monthKey))}`
  return project.startDate <= monthEnd && projectLastDate(project) >= monthStart
}

export function formatMoney(value: number, withSymbol = true): string {
  const formatted = new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value))
  return `${withSymbol ? activeCurrencySymbol() : ''}${formatted}`
}

export function formatSignedMoney(value: number, withSymbol = true): string {
  return `${value < 0 ? '−' : ''}${formatMoney(value, withSymbol)}`
}

export function formatMoneyCompact(value: number): string {
  const symbol = activeCurrencySymbol()
  const absolute = Math.abs(value)
  if (absolute >= 10000) {
    const amount = value / 10000
    return `${symbol}${Number.isInteger(amount) ? amount : amount.toFixed(1)}万`
  }
  if (absolute >= 1000) {
    const amount = value / 1000
    return `${symbol}${Number.isInteger(amount) ? amount : amount.toFixed(1)}k`
  }
  return `${symbol}${Math.round(value)}`
}

export function formatAxisNumber(value: number): string {
  if (value >= 10000) {
    const amount = value / 10000
    return `${Number.isInteger(amount) ? amount : Number(amount.toFixed(2))}万`
  }
  return new Intl.NumberFormat('zh-CN').format(value)
}

export function formatPercent(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`
}

export function getDaysLeft(monthKey: string): number {
  if (monthKey !== currentMonthKey()) return 0
  return daysInMonthOfKey(monthKey) - new Date().getDate() + 1
}

export function largestExpense(
  transactions: LedgerTransaction[],
): LedgerTransaction | null {
  // A refund is never the month's biggest purchase, even if its amount is.
  const expenses = transactions.filter(
    (item) => item.type === 'expense' && !isRefund(item),
  )
  if (expenses.length === 0) return null
  return expenses.reduce((max, item) =>
    item.amountCents > max.amountCents ? item : max,
  )
}

export function topWeekdaySpending(
  transactions: LedgerTransaction[],
): { label: string; value: number } | null {
  const values = new Array<number>(7).fill(0)
  for (const item of transactions) {
    if (item.type !== 'expense') continue
    values[dateFromKey(item.date).getDay()] += expenseDeltaCents(item) / 100
  }
  const max = Math.max(...values)
  if (max <= 0) return null
  return { label: WEEKDAYS[values.indexOf(max)], value: max }
}

export function categoryNameById(
  id: string,
  type: TransactionType = 'expense',
): string {
  return getCategory(id, type).name
}

export function categoryPathNameById(
  id: string,
  type: TransactionType = 'expense',
): string {
  return getCategoryPathName(getCategory(id, type))
}

export function allCategoryIds(type: TransactionType): string[] {
  return getCategoriesForType(type).map((category) => category.id)
}

export function escapeCsv(value: string | number): string {
  const text = String(value)
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function transactionsToCsv(
  transactions: LedgerTransaction[],
): string {
  const header = ['日期', '类型', '分类', '账户', '金额', '备注']
  const rows = transactions.map((item) => [
    item.date,
    transactionKindLabel(item),
    categoryPathNameById(item.categoryId, item.type),
    getAccount(item.accountId).name,
    (item.amountCents / 100).toFixed(2),
    item.note,
  ])
  return [
    header.map(escapeCsv).join(','),
    ...rows.map((row) => row.map(escapeCsv).join(',')),
  ].join('\r\n')
}

export function downloadFile(
  filename: string,
  content: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
