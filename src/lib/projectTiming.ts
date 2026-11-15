import type { LedgerTransaction, Project, TransactionType } from '../types'
import { allocationDeltaCents } from './refunds'
import { projectLastDate } from './utils'

/** A date outside the project's own period: before it starts or after it ends. */
export type ProjectTiming = 'pre' | 'post'

export interface ProjectTimingHit {
  project: Project
  timing: ProjectTiming
}

export interface ProjectTimingTotals {
  preExpenseCents: number
  postExpenseCents: number
  preExpenseCount: number
  postExpenseCount: number
  preIncomeCents: number
  postIncomeCents: number
  preIncomeCount: number
  postIncomeCount: number
}

export function emptyProjectTimingTotals(): ProjectTimingTotals {
  return {
    preExpenseCents: 0,
    postExpenseCents: 0,
    preExpenseCount: 0,
    postExpenseCount: 0,
    preIncomeCents: 0,
    postIncomeCents: 0,
    preIncomeCount: 0,
    postIncomeCount: 0,
  }
}

/**
 * Compares a date with the project's own period. Open-ended active projects
 * have no upper bound, matching projectCoversDate elsewhere in the ledger.
 */
export function projectTimingForDate(
  project: Project,
  date: string,
): ProjectTiming | null {
  if (!date) return null
  if (date < project.startDate) return 'pre'
  if (date > projectLastDate(project)) return 'post'
  return null
}

/** 前置支出 / 后置支出, and the income equivalents for project receipts. */
export function projectTimingLabel(
  timing: ProjectTiming,
  type: TransactionType,
): string {
  const direction = timing === 'pre' ? '前置' : '后置'
  return `${direction}${type === 'income' ? '收入' : '支出'}`
}

/** Human-readable period used by the transaction form's recommendation hint. */
export function projectPeriodLabel(project: Project): string {
  const last = projectLastDate(project)
  return last === '9999-12-31'
    ? `${project.startDate} 起（未设结束）`
    : `${project.startDate} → ${last}`
}

/**
 * Pulls a date into the project period. Used as the soft default when a
 * project is selected; the user can still pick any date afterwards.
 */
export function clampDateToProject(project: Project, date: string): string {
  if (!date) return date
  const last = projectLastDate(project)
  if (date < project.startDate) return project.startDate
  if (date > last) return last === '9999-12-31' ? date : last
  return date
}

/**
 * Every project allocation on a transaction whose date falls outside that
 * project's period. `projectId` scopes the check to the project detail view.
 */
export function transactionTimingHits(
  transaction: LedgerTransaction,
  projects: readonly Project[],
  projectId?: string,
): ProjectTimingHit[] {
  const seen = new Set<string>()
  const hits: ProjectTimingHit[] = []

  for (const line of transaction.allocations) {
    if (line.targetType !== 'project' || !line.projectId) continue
    if (projectId && line.projectId !== projectId) continue
    if (seen.has(line.projectId)) continue
    seen.add(line.projectId)

    const project = projects.find((item) => item.id === line.projectId)
    if (!project) continue
    const timing = projectTimingForDate(project, transaction.date)
    if (timing) hits.push({ project, timing })
  }

  return hits
}

/** Pre/post totals for one project, used by the project reports. */
export function getProjectTimingTotals(
  transactions: readonly LedgerTransaction[],
  project: Project,
): ProjectTimingTotals {
  const totals = emptyProjectTimingTotals()

  for (const transaction of transactions) {
    const timing = projectTimingForDate(project, transaction.date)
    if (!timing) continue

    for (const line of transaction.allocations) {
      if (line.targetType !== 'project' || line.projectId !== project.id) {
        continue
      }
      const cents = allocationDeltaCents(transaction, line)
      if (transaction.type === 'income') {
        if (timing === 'pre') {
          totals.preIncomeCents += cents
          totals.preIncomeCount += 1
        } else {
          totals.postIncomeCents += cents
          totals.postIncomeCount += 1
        }
      } else if (timing === 'pre') {
        totals.preExpenseCents += cents
        totals.preExpenseCount += 1
      } else {
        totals.postExpenseCents += cents
        totals.postExpenseCount += 1
      }
    }
  }

  return totals
}
