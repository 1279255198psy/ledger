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

export type ReminderFrequency = 'daily' | 'weekdays' | 'weekends' | 'custom'

/**
 * A gentle nudge to keep the ledger current. The same settings drive three
 * schedulers: the Tauri tray app, Android local notifications, and the
 * browser Notification API used in the preview build.
 */
export interface ReminderSettings {
  enabled: boolean
  /** Local wall-clock time, "HH:mm". */
  time: string
  frequency: ReminderFrequency
  /** Days used by the custom frequency; 0 = Sunday … 6 = Saturday. */
  weekdays: number[]
  /** Desktop only: launch at login and start minimized to the tray. */
  autoStart: boolean
}

/** How the daily budget is derived for one month. */
export type DailyBudgetMode = 'off' | 'auto' | 'manual'

/** One recorded change to a month's effective budget. */
export interface BudgetAdjustment {
  id: string
  /** ISO timestamp of when the change was recorded. */
  at: string
  beforeCents: number
  afterCents: number
  /** afterCents - beforeCents; positive is an increase. */
  deltaCents: number
  /** Why the budget changed. Every new adjustment needs one. */
  note: string
  /** "adjust" is a live change; "replan" rewrites the month's baseline. */
  kind: 'adjust' | 'replan'
}

/** A budget plan belongs to one concrete month; months never share values. */
export interface MonthBudget {
  /** YYYY-MM */
  month: string
  /** The amount currently in force. Every surface reads this number. */
  amountCents: number
  /** The amount originally planned; absent on older records. */
  baseAmountCents?: number
  /** Append-only history of amount changes, oldest first. */
  adjustments?: BudgetAdjustment[]
  dailyMode: DailyBudgetMode
  /** Manual daily amounts, keyed by calendar day ("1" … "31"). */
  dailyAmountsCents?: Record<string, number>
  /** Monthly caps for top-level expense categories, keyed by category id. */
  categoryBudgetsCents?: Record<string, number>
}

/** Every month the user has explicitly configured. */
export type BudgetBook = Record<string, MonthBudget>

/**
 * A budget for an arbitrary inclusive date range. It uses the same amount,
 * daily and category rules as a month budget; when the range crosses months the
 * days stay one continuous plan and no monthly totals are reconciled.
 */
export interface RangeBudget {
  id: string
  /** Optional label such as 旅行 or 装修. */
  name?: string
  /** YYYY-MM-DD */
  startDate: string
  /** YYYY-MM-DD */
  endDate: string
  amountCents: number
  dailyMode: DailyBudgetMode
  /** Manual daily amounts, keyed by date (YYYY-MM-DD). */
  dailyAmountsCents?: Record<string, number>
  /** Caps for top-level expense categories, keyed by category id. */
  categoryBudgetsCents?: Record<string, number>
}

export type BudgetSource = 'set' | 'inherited' | 'default'

export interface ResolvedMonthBudget {
  budget: MonthBudget
  source: BudgetSource
  /** The month this plan was inherited from, when source is 'inherited'. */
  sourceMonth?: string
}

export interface CategoryBudgetStatus {
  categoryId: string
  category: Category
  budgetCents: number
  spentCents: number
  remainingCents: number
  ratio: number
}

export interface DailyBudgetDay {
  /** 1-based position inside the month or custom range. */
  day: number
  /** YYYY-MM-DD */
  date: string
  budgetCents: number
  spentCents: number
  remainingCents: number
  /** True when auto mode moved this day away from the even split. */
  autoAdjusted: boolean
}

export interface DailyBudgetStatus {
  mode: Exclude<DailyBudgetMode, 'off'>
  days: DailyBudgetDay[]
  /** Even split across the whole month or range. */
  baseDailyCents: number
  /** Day index treated as "today" (clamped into the scope). */
  today: number
  /** Date treated as "today" (clamped into the scope). */
  todayDate: string
  /** True when today really falls inside this month or range. */
  isLive: boolean
  todayBudgetCents: number
  todaySpentCents: number
  todayRemainingCents: number
  /** Tomorrow's allowance after today's actual spending (live scopes only). */
  tomorrowBudgetCents: number | null
  overToday: boolean
  overSeverity: 'none' | 'warn' | 'serious'
  overByCents: number
  /** Manual mode: sum of every day's amount. */
  manualTotalCents: number
  /** Manual mode: daily total minus the scope amount. */
  manualMismatchCents: number
  /** Manual mode: later day allowances exceed the remaining scope amount. */
  manualShortfallCents: number
  allowanceTooLow: boolean
  allowanceTooHigh: boolean
  remainingCents: number
  daysLeft: number
}

export interface MonthBudgetMetrics {
  monthKey: string
  amountCents: number
  /** The month's original plan; equals amountCents when never adjusted. */
  baseAmountCents: number
  /** amountCents - baseAmountCents. */
  adjustedDeltaCents: number
  adjustments: BudgetAdjustment[]
  spentCents: number
  remainingCents: number
  ratio: number
  source: BudgetSource
  sourceMonth?: string
  daily: DailyBudgetStatus | null
  categories: CategoryBudgetStatus[]
  categoryBudgetTotalCents: number
  unallocatedCents: number
  overBudget: boolean
}

export interface RangeBudgetMetrics {
  range: RangeBudget
  /** YYYY-MM-DD, inclusive. */
  startDate: string
  /** YYYY-MM-DD, inclusive. */
  endDate: string
  dayCount: number
  amountCents: number
  spentCents: number
  remainingCents: number
  ratio: number
  /** True while today falls inside the range. */
  active: boolean
  /** Days from the start up to today (0 before the range starts). */
  elapsedDays: number
  daysLeft: number
  daily: DailyBudgetStatus | null
  categories: CategoryBudgetStatus[]
  categoryBudgetTotalCents: number
  unallocatedCents: number
  overBudget: boolean
}

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
  /**
   * 退款仍然存成正金额，汇总时按负号计入所属分类，所以它冲减原类目而不是
   * 变成一笔收入。只对 type === 'expense' 有意义。
   */
  kind?: TransactionKind
  allocations: AllocationLine[]
  createdAt: string
  updatedAt?: string
  /** 由周期规则生成时，记录来源规则。 */
  recurringRuleId?: string
  /** 这一笔对应的周期日期（YYYY-MM-DD）。 */
  recurringPeriod?: string
  /** 「只改这次」后与规则脱离，规则不再覆盖它。 */
  recurringDetached?: boolean
}

export type TransactionKind = 'refund'

export interface ProjectDraft {
  name: string
  startDate: string
  endDate?: string
  budgetCents?: number
  categoryBudgetsCents?: Record<string, number>
  /** When true, this project's spending also counts as daily spending. */
  countsInDaily?: boolean
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
  /**
   * True when the project's spending should also count toward daily spending
   * and the daily/monthly/range budgets. Unset means it is accounted for on
   * its own, exactly like before this option existed.
   */
  countsInDaily?: boolean
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

export type AccountType = 'wechat' | 'alipay' | 'cash' | 'bank'

export interface Account {
  id: string
  name: string
  type: AccountType
  /** Issuing bank for type 'bank'; free-form custom names are allowed. */
  bank?: string
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
  /**
   * Whether this posting belongs to the daily bucket: either a daily
   * allocation, or a project allocation whose project opts into daily.
   */
  countsAsDaily: boolean
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

/** 周期频率。日期类规则在到期的月份里会裁剪到当月最后一天。 */
export type RecurringFrequency =
  | { kind: 'monthly'; day: number }
  | { kind: 'weekly'; weekday: number }
  | { kind: 'yearly'; month: number; day: number }
  | { kind: 'interval'; days: number }

/** 到期后直接入账，还是先进入待确认队列。 */
export type RecurringMode = 'auto' | 'confirm'

export type RecurringEditScope = 'once' | 'future' | 'stop'

export interface RecurringTemplate {
  type: TransactionType
  amountCents: number
  categoryId: string
  accountId: string
  note: string
  spendingNature?: SpendingNature
  allocations: AllocationLine[]
}

/**
 * 用户自己定的固定账：房租、工资、会员费。规则随账本同步，生成流水时使用
 * 确定性 id，因此多次启动或双端同时补齐都不会重复。
 */
export interface RecurringRule {
  id: string
  schemaVersion: 1
  enabled: boolean
  template: RecurringTemplate
  frequency: RecurringFrequency
  /** YYYY-MM-DD，首次到期日不会早于它。 */
  startDate: string
  /** YYYY-MM-DD，含当天；不填表示一直重复。 */
  endDate?: string
  mode: RecurringMode
  /** 已处理到哪一期；只由补齐逻辑推进，不算用户编辑。 */
  generatedThrough?: string
  stoppedAt?: string
  createdAt: string
  updatedAt: string
}

/** 到期后等待用户确认的一期，确认前不计入余额和预算。 */
export interface RecurringPending {
  /** rp:<ruleId>:<date>，确定性 id 用来跨端去重。 */
  id: string
  ruleId: string
  /** YYYY-MM-DD */
  date: string
  /** 生成时的模板快照，之后改规则不会改写已经生成的一期。 */
  template: RecurringTemplate
  createdAt: string
}

/** 新建或编辑规则时，表单里收集的周期设置。 */
export interface RecurringDraft {
  frequency: RecurringFrequency
  startDate: string
  endDate?: string
  mode: RecurringMode
}

export interface TransactionDraft {
  type: TransactionType
  amountCents: number
  categoryId: string
  accountId: string
  date: string
  note: string
  spendingNature?: SpendingNature
  kind?: TransactionKind
  allocations?: AllocationLine[]
  /** 新建时一并创建周期规则。 */
  recurring?: RecurringDraft
  /** 编辑某一期周期流水时的修改范围。 */
  recurringEditScope?: RecurringEditScope
}

/**
 * Partial values used to prefill a new entry, currently from a captured
 * payment notification. Missing fields keep the form's normal defaults.
 */
export interface TransactionDraftSeed {
  type?: TransactionType
  amountCents?: number
  categoryId?: string
  accountId?: string
  date?: string
  note?: string
  spendingNature?: SpendingNature
  kind?: TransactionKind
}
