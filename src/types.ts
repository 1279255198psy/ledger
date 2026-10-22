export type TransactionType = 'expense' | 'income'

export type View =
  | 'overview'
  | 'transactions'
  | 'projects'
  | 'analytics'
  | 'liabilities'
  | 'indices'

/** 刚需 / 弹性：支出在财务健康指标里的性质。 */
export type SpendingNature = 'essential' | 'flexible'

export type IndexGranularity = 'month' | 'quarter'

export type IndexMetricKey =
  | 'engel'
  | 'savings'
  | 'essential'
  | 'flexible'
  | 'emergency'
  | 'debt'
  | 'netWorth'

export interface IndexPreferences {
  granularity: IndexGranularity
  /** 被隐藏的指标；综合得分固定显示，不在此列。 */
  hidden: IndexMetricKey[]
}

export type Theme = 'light' | 'dark'

export type Palette = 'forest' | 'gold' | 'navy' | 'rose'

export type Currency = 'CNY' | 'USD' | 'GBP' | 'EUR' | 'JPY' | 'KRW'

export type FontSize = 'small' | 'standard' | 'large' | 'xlarge'

export type ProjectStatus = 'active' | 'closed'

export type AllocationTarget = 'daily' | 'project'

export type AllocationBasis = 'ratio' | 'headcount' | 'fixed' | 'migrated'

export type TransactionScope = 'daily' | 'project' | 'shared'

export interface AllocationLine {
  id: string
  targetType: AllocationTarget
  projectId?: string
  amountCents: number
  weight?: number
  ratioBp?: number
  basis: AllocationBasis
  note?: string
}

export interface LedgerTransaction {
  id: string
  schemaVersion: 2
  type: TransactionType
  amountCents: number
  categoryId: string
  accountId: string
  date: string
  note: string
  /** 支出专用；旧数据可能没有标记。 */
  spendingNature?: SpendingNature
  allocations: AllocationLine[]
  createdAt: string
  updatedAt?: string
}

export interface ProjectDraft {
  name: string
  startDate: string
  endDate?: string
  budgetCents?: number
  categoryBudgetsCents?: Record<string, number>
  note?: string
}

export interface Project {
  id: string
  name: string
  code?: string
  status: ProjectStatus
  startDate: string
  endDate?: string
  budgetCents?: number
  categoryBudgetsCents?: Record<string, number>
  currency: Currency
  owner?: string
  note?: string
  archivedAt?: string
  createdAt: string
  updatedAt: string
}

export interface Category {
  id: string
  name: string
  type: TransactionType
  /** Optional fixed hex color. Built-ins without one follow the active theme. */
  color?: string
  /** Key into the shared category icon set. */
  icon?: string
  /** Top-level category this belongs to. Subcategories are one level deep. */
  parentId?: string
}

export interface LiabilityRepayment {
  id: string
  amountCents: number
  date: string
  note?: string
  createdAt: string
}

export interface Liability {
  id: string
  name: string
  principalCents: number
  dueDate?: string
  note?: string
  repayments: LiabilityRepayment[]
  createdAt: string
  updatedAt: string
}

export interface LiabilityDraft {
  name: string
  principalCents: number
  dueDate?: string
  note?: string
}

export interface RepaymentDraft {
  amountCents: number
  date: string
  note?: string
}

export interface LiabilitySummary {
  repaidCents: number
  remainingCents: number
  settled: boolean
  overdue: boolean
}

export interface Account {
  id: string
  name: string
}

export interface MonthTotals {
  income: number
  expense: number
  balance: number
}

export interface MonthDatum {
  key: string
  label: string
  value: number
}

export interface MonthPairDatum {
  key: string
  label: string
  income: number
  expense: number
}

export interface DailyDatum {
  day: number
  value: number
}

export interface CategoryTotal {
  category: Category
  value: number
  share: number
}

export interface Posting {
  month: string
  date: string
  transactionId: string
  allocationId: string
  kind: TransactionType
  targetType: AllocationTarget
  projectId?: string
  categoryId: string
  signedCents: number
}

export interface MonthSpendCents {
  dailyCents: number
  projectCents: number
  totalCents: number
}

export interface ProjectMonthTotal {
  month: string
  expenseCents: number
  cumulativeExpenseCents: number
}

export interface ProjectSummary {
  projectId: string
  totalExpenseCents: number
  totalIncomeCents: number
  netCents: number
  byMonth: ProjectMonthTotal[]
}

export interface ProjectMonthRow {
  projectId: string
  monthExpenseCents: number
  monthIncomeCents: number
  cumulativeExpenseCents: number
  cumulativeIncomeCents: number
}

export interface TransactionDraft {
  type: TransactionType
  amountCents: number
  categoryId: string
  accountId: string
  date: string
  note: string
  spendingNature?: SpendingNature
  allocations?: AllocationLine[]
}
