import { useState } from 'react'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowRight,
  ArrowUpDown,
  ArrowUpRight,
  BellRing,
  CalendarRange,
  CircleDollarSign,
  PencilLine,
  ReceiptText,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { BalanceSummary } from '../components/BalanceSummary'
import { BudgetAdjustDialog } from '../components/BudgetAdjustDialog'
import { CategoryIcon } from '../components/CategoryIcon'
import { CategoryBars } from '../components/charts/CategoryBars'
import { RangeBudgetPanel } from '../components/RangeBudgetPanel'
import { activeCurrencySymbol } from '../lib/currency'
import { EmptyLedger } from '../components/EmptyLedger'
import { OnboardingCard } from '../components/OnboardingCard'
import { ExpenseTrendChart } from '../components/charts/ExpenseTrendChart'
import { RecurringPendingCard } from '../components/RecurringPendingCard'
import { TransactionRow } from '../components/TransactionRow'
import { getCountedProjectIds, getMonthSpendCents } from '../lib/allocations'
import { getBudgetWarnings } from '../lib/budget'
import { expenseDeltaCents } from '../lib/refunds'
import {
  buildMonthSeries,
  daysElapsedInMonth,
  formatMoney,
  formatPercent,
  getCategoryTotals,
  getDaysLeft,
  getMonthTransactions,
  getTotals,
  isCurrentMonth,
  monthLabel,
  monthShortLabel,
  percentChange,
  shiftMonth,
} from '../lib/utils'
import type {
  Category,
  LedgerTransaction,
  MonthBudgetMetrics,
  Project,
  RangeBudgetMetrics,
  RecurringPending,
  View,
} from '../types'

interface OverviewProps {
  transactions: LedgerTransaction[]
  projects: Project[]
  categories: Category[]
  monthKey: string
  budgetMetrics: MonthBudgetMetrics
  rangeMetrics: RangeBudgetMetrics[]
  openingBalance: number
  pendingCaptureCount: number
  pendingCaptureTotalCents: number
  recurringPending: RecurringPending[]
  onConfirmRecurring: (item: RecurringPending) => void
  onSkipRecurring: (item: RecurringPending) => void
  onOpenPendingCaptures: () => void
  onAdd: () => void
  onEdit: (transaction: LedgerTransaction) => void
  onDelete: (id: string) => void
  onChangeView: (view: View) => void
  onOpenBudget: () => void
  onBudgetAdjust: (
    monthKey: string,
    amountCents: number,
    note: string,
    rescheduleDaily: boolean,
  ) => void
  onOpenRangeBudget: () => void
  onOpenOpeningBalance: () => void
  onLoadSample: () => void
  showOnboarding: boolean
  hasMonthBudget: boolean
  hasCategoryBudget: boolean
  onOpenGuide: () => void
  onDismissOnboarding: () => void
}

function PendingCaptureBanner({
  count,
  totalCents,
  onOpen,
}: {
  count: number
  totalCents: number
  onOpen: () => void
}) {
  if (count <= 0) return null
  return (
    <button type="button" className="pending-banner" onClick={onOpen}>
      <span className="pending-banner-icon" aria-hidden="true">
        <BellRing size={16} />
      </span>
      <span className="pending-banner-copy">
        <strong>{count} 笔待标注</strong>
        <small>
          来自付款通知
          {totalCents > 0 ? ` · 约 ${formatMoney(totalCents / 100)}` : ''}
        </small>
      </span>
      <ArrowRight size={16} aria-hidden="true" />
    </button>
  )
}

function HeroBalance({ value }: { value: number }) {
  const negative = value < 0
  const [whole, cents] = formatMoney(Math.abs(value), false).split('.')
  return (
    <div
      className="hero-amount"
      aria-label={`本月结余 ${negative ? '负' : ''}${formatMoney(Math.abs(value))}`}
    >
      {negative ? <span className="hero-minus">−</span> : null}
      <span className="hero-currency">{activeCurrencySymbol()}</span>
      <span>{whole}</span>
      <span className="hero-cents">.{cents}</span>
    </div>
  )
}

export function Overview({
  transactions,
  projects,
  categories: allCategories,
  monthKey,
  budgetMetrics,
  rangeMetrics,
  openingBalance,
  pendingCaptureCount,
  pendingCaptureTotalCents,
  recurringPending,
  onConfirmRecurring,
  onSkipRecurring,
  onOpenPendingCaptures,
  onAdd,
  onEdit,
  onDelete,
  onChangeView,
  onOpenBudget,
  onBudgetAdjust,
  onOpenRangeBudget,
  onOpenOpeningBalance,
  onLoadSample,
  showOnboarding,
  hasMonthBudget,
  hasCategoryBudget,
  onOpenGuide,
  onDismissOnboarding,
}: OverviewProps) {
  const [adjustOpen, setAdjustOpen] = useState(false)

  if (transactions.length === 0) {
    return (
      <div className="page-stack overview-page">
        <PendingCaptureBanner
          count={pendingCaptureCount}
          totalCents={pendingCaptureTotalCents}
          onOpen={onOpenPendingCaptures}
        />
        <RecurringPendingCard
          items={recurringPending}
          categories={allCategories}
          compact
          onConfirm={onConfirmRecurring}
          onSkip={onSkipRecurring}
          onOpenAll={() => onChangeView('transactions')}
        />
        <BalanceSummary
          transactions={transactions}
          monthKey={monthKey}
          openingBalance={openingBalance}
          onAdjustOpeningBalance={onOpenOpeningBalance}
        />
        <EmptyLedger onAdd={onAdd} onLoadSample={onLoadSample} />
      </div>
    )
  }

  const monthTransactions = getMonthTransactions(transactions, monthKey)
  const totals = getTotals(monthTransactions)
  const spend = getMonthSpendCents(
    transactions,
    monthKey,
    getCountedProjectIds(projects),
  )
  const dailyExpense = budgetMetrics.spentCents / 100
  const projectExpense = spend.projectCents / 100
  const countedProjectCount = projects.filter(
    (project) => project.countsInDaily,
  ).length
  const budget = budgetMetrics.amountCents / 100
  const categories = getCategoryTotals(monthTransactions, 'expense')
  const previousKey = shiftMonth(monthKey, -1)
  const todayDay = new Date().getDate()
  const cutoff = isCurrentMonth(monthKey) ? todayDay : 31
  const previousComparableExpense = getMonthTransactions(
    transactions,
    previousKey,
  )
    .filter(
      (item) =>
        item.type === 'expense' && Number(item.date.slice(8, 10)) <= cutoff,
    )
    .reduce((sum, item) => sum + expenseDeltaCents(item) / 100, 0)
  const expenseChange = percentChange(totals.expense, previousComparableExpense)
  const comparisonLabel = isCurrentMonth(monthKey) ? '较上月同期' : '较上月'
  const elapsed = Math.max(daysElapsedInMonth(monthKey), 1)
  const dailyAverage = dailyExpense / elapsed
  const topCategory = categories[0]
  const remaining = budgetMetrics.remainingCents / 100
  const ratio = budgetMetrics.ratio
  const daysLeft = getDaysLeft(monthKey)
  const dailyAllowance = daysLeft > 0 ? Math.max(remaining, 0) / daysLeft : 0
  const daily = budgetMetrics.daily
  const isCurrent = isCurrentMonth(monthKey)
  const budgetWarnings = getBudgetWarnings(budgetMetrics)
  const overDailyDays = daily
    ? daily.days.filter(
        (entry) => entry.budgetCents > 0 && entry.spentCents > entry.budgetCents,
      ).length
    : 0
  const sortedCategoryBudgets = [...budgetMetrics.categories].sort(
    (left, right) => right.ratio - left.ratio,
  )
  const budgetSourceNote =
    budgetMetrics.source === 'inherited' && budgetMetrics.sourceMonth
      ? `沿用 ${monthShortLabel(budgetMetrics.sourceMonth)} 的预算`
      : budgetMetrics.source === 'default'
        ? '默认预算 · 可在设置中调整'
        : null
  const recent = [...monthTransactions].slice(0, 6)
  const expenseCount = monthTransactions.filter(
    (item) => item.type === 'expense',
  ).length
  const incomeCount = monthTransactions.length - expenseCount
  const series = buildMonthSeries(transactions, monthKey, 6, 'expense')

  return (
    <div className="page-stack overview-page">
      <PendingCaptureBanner
        count={pendingCaptureCount}
        totalCents={pendingCaptureTotalCents}
        onOpen={onOpenPendingCaptures}
      />
      <RecurringPendingCard
        items={recurringPending}
        categories={allCategories}
        compact
        onConfirm={onConfirmRecurring}
        onSkip={onSkipRecurring}
        onOpenAll={() => onChangeView('transactions')}
      />

      {showOnboarding ? (
        <OnboardingCard
          hasMonthBudget={hasMonthBudget}
          hasCategoryBudget={hasCategoryBudget}
          onOpenBudget={onOpenBudget}
          onOpenGuide={onOpenGuide}
          onDismiss={onDismissOnboarding}
        />
      ) : null}

      <div className="overview-hero-grid">
        <section className="hero-card" aria-labelledby="balance-heading">
          <div className="hero-orb hero-orb--one" aria-hidden="true" />
          <div className="hero-orb hero-orb--two" aria-hidden="true" />
          <div className="hero-top">
            <div>
              <p className="hero-eyebrow" id="balance-heading">
                {monthLabel(monthKey)} ·{' '}
                {isCurrentMonth(monthKey) ? '本月结余' : '当月结余'}
              </p>
              <span className="hero-badge">
                {totals.balance >= 0 ? '收支从容' : '支出偏高'}
              </span>
            </div>
            <div className="hero-seal" aria-hidden="true">
              账簿
            </div>
          </div>

          <HeroBalance value={totals.balance} />

          <div className="hero-breakdown">
            <div className="hero-metric">
              <span className="hero-metric-icon is-income">
                <ArrowDownLeft size={16} />
              </span>
              <div>
                <span>收入</span>
                <strong>{formatMoney(totals.income)}</strong>
              </div>
            </div>
            <div className="hero-metric">
              <span className="hero-metric-icon is-expense">
                <ArrowUpRight size={16} />
              </span>
              <div>
                <span>支出总额</span>
                <strong>{formatMoney(totals.expense)}</strong>
              </div>
            </div>
          </div>

          <p className="hero-comparison">
            {expenseChange === null ? (
              <span className="is-calm">这是账本里的第一个月</span>
            ) : (
              <span className={expenseChange <= 0 ? 'is-good' : 'is-warning'}>
                {expenseChange <= 0 ? (
                  <TrendingDown size={15} />
                ) : (
                  <TrendingUp size={15} />
                )}
                支出{comparisonLabel}
                {expenseChange <= 0 ? '减少' : '增加'}{' '}
                {formatPercent(Math.abs(expenseChange), 1)}
              </span>
            )}
            <span className="hero-comparison-note">
              共记下 {monthTransactions.length} 笔
            </span>
          </p>
        </section>

        <section className="card budget-card" aria-labelledby="budget-heading">
          <div className="card-head">
            <div>
              <p className="card-kicker">BUDGET</p>
              <h2 id="budget-heading">
                {isCurrent ? '本月生活预算' : '当月生活预算'}
              </h2>
              {budgetSourceNote ? (
                <p className="budget-source-note">{budgetSourceNote}</p>
              ) : null}
            </div>
            <div className="budget-card-actions">
              {isCurrent ? (
                <button
                  type="button"
                  className="budget-adjust-trigger"
                  onClick={() => setAdjustOpen(true)}
                >
                  <ArrowUpDown size={14} />
                  调整本月预算
                </button>
              ) : null}
              <button
                type="button"
                className="icon-button icon-button--small"
                onClick={onOpenBudget}
                aria-label="编辑预算"
                title="编辑预算"
              >
                <PencilLine size={16} />
              </button>
            </div>
          </div>

          <div className="budget-figure">
            <strong>{formatPercent(ratio * 100)}</strong>
            <span>
              生活支出占比 ·{' '}
              {budgetMetrics.adjustments.length > 0 ? '当前预算' : '月预算'}{' '}
              {formatMoney(budget)}
            </span>
          </div>

          <p className="budget-adjust-meta">
            原定预算 {formatMoney(budgetMetrics.baseAmountCents / 100)}
            {budgetMetrics.adjustments.length > 0 ? (
              <>
                {' · '}
                {budgetMetrics.adjustedDeltaCents < 0
                  ? '已下调'
                  : budgetMetrics.adjustedDeltaCents > 0
                    ? '已上调'
                    : '净变化'}{' '}
                {formatMoney(Math.abs(budgetMetrics.adjustedDeltaCents) / 100)}
                <span>共 {budgetMetrics.adjustments.length} 次</span>
              </>
            ) : (
              <span>尚未调整</span>
            )}
          </p>

          <div
            className="budget-meter"
            role="meter"
            aria-label="生活预算使用进度"
            aria-valuemin={0}
            aria-valuemax={budget}
            aria-valuenow={Math.min(dailyExpense, budget)}
          >
            <span
              className={remaining < 0 ? 'is-over' : ''}
              style={{ width: `${Math.min(ratio * 100, 100)}%` }}
            />
          </div>

          <div className="budget-amounts">
            <div>
              <span>已用生活</span>
              <strong>{formatMoney(dailyExpense)}</strong>
            </div>
            <div>
              <span>{remaining < 0 ? '超出' : '剩余'}</span>
              <strong className={remaining < 0 ? 'is-negative' : ''}>
                {formatMoney(Math.abs(remaining))}
              </strong>
            </div>
          </div>

          {daily ? (
            <div
              className={`daily-budget${
                isCurrent && daily.overToday ? ' is-over' : ''
              }`}
            >
              <div className="daily-budget-head">
                <span>
                  每日预算 ·{' '}
                  {daily.mode === 'auto' ? '自动均分' : '自定义'}
                </span>
                <span
                  className={`daily-budget-chip${
                    isCurrent && daily.overToday ? ' is-over' : ''
                  }`}
                >
                  {isCurrent
                    ? daily.overToday
                      ? '今日超出'
                      : '今日在额度内'
                    : `本月 ${overDailyDays} 天超出`}
                </span>
              </div>

              {isCurrent ? (
                <>
                  <div className="daily-budget-figures">
                    <div>
                      <span>今日额度</span>
                      <strong>
                        {formatMoney(daily.todayBudgetCents / 100)}
                      </strong>
                    </div>
                    <div>
                      <span>今日已用</span>
                      <strong
                        className={
                          daily.todayRemainingCents < 0 ? 'is-negative' : ''
                        }
                      >
                        {formatMoney(daily.todaySpentCents / 100)}
                      </strong>
                    </div>
                    <div>
                      <span>
                        {daily.todayRemainingCents < 0 ? '超出' : '剩余'}
                      </span>
                      <strong
                        className={
                          daily.todayRemainingCents < 0 ? 'is-negative' : ''
                        }
                      >
                        {formatMoney(
                          Math.abs(daily.todayRemainingCents) / 100,
                        )}
                      </strong>
                    </div>
                  </div>
                  <div className="daily-budget-meter" aria-hidden="true">
                    <span
                      className={
                        daily.todayRemainingCents < 0 ? 'is-over' : ''
                      }
                      style={{
                        width: `${Math.min(
                          daily.todayBudgetCents > 0
                            ? (daily.todaySpentCents /
                                daily.todayBudgetCents) *
                                100
                            : 100,
                          100,
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="daily-budget-note">
                    {daily.mode === 'auto' ? (
                      daily.tomorrowBudgetCents !== null ? (
                        <>
                          月均分 {formatMoney(daily.baseDailyCents / 100)}，
                          明天将自动调整为{' '}
                          <strong>
                            {formatMoney(daily.tomorrowBudgetCents / 100)}
                          </strong>
                          。
                        </>
                      ) : (
                        <>月底最后一天，额度会随剩余余额自动收拢。</>
                      )
                    ) : (
                      <>
                        手动额度固定；若今日超出，可在预算设置中重排剩余天数。
                      </>
                    )}
                  </p>
                </>
              ) : (
                <div className="daily-budget-figures">
                  <div>
                    <span>每日均分</span>
                    <strong>{formatMoney(daily.baseDailyCents / 100)}</strong>
                  </div>
                  <div>
                    <span>
                      {daily.mode === 'manual' ? '每日合计' : '日均支出'}
                    </span>
                    <strong>
                      {daily.mode === 'manual'
                        ? formatMoney(daily.manualTotalCents / 100)
                        : formatMoney(
                            dailyExpense / Math.max(daily.days.length, 1),
                          )}
                    </strong>
                  </div>
                  <div>
                    <span>超出天数</span>
                    <strong>{overDailyDays} 天</strong>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <p className="budget-daily-hint">
              打开每日预算后，这里会显示今天的额度、超支预警和自动调整结果。
            </p>
          )}

          {budgetWarnings.length > 0 ? (
            <div className="budget-alerts">
              {budgetWarnings.slice(0, 3).map((warning) => {
                const actionable =
                  warning.kind !== 'daily-over' ||
                  (daily?.mode === 'manual' && daily.overToday)
                return (
                  <div
                    key={`${warning.kind}-${warning.title}`}
                    className={`budget-alert is-${warning.tone}`}
                  >
                    <AlertTriangle size={15} />
                    <div className="budget-alert-copy">
                      <strong>{warning.title}</strong>
                      <span>{warning.detail}</span>
                    </div>
                    {actionable ? (
                      <button
                        type="button"
                        className="budget-alert-action"
                        onClick={onOpenBudget}
                      >
                        调整预算
                      </button>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}

          {sortedCategoryBudgets.length > 0 ? (
            <details className="budget-categories">
              <summary>
                <span>分类预算 · {sortedCategoryBudgets.length} 项</span>
                <span
                  className={
                    budgetMetrics.unallocatedCents < 0 ? 'is-negative' : ''
                  }
                >
                  {budgetMetrics.unallocatedCents >= 0
                    ? `未分配 ${formatMoney(
                        budgetMetrics.unallocatedCents / 100,
                      )}`
                    : `超出月预算 ${formatMoney(
                        Math.abs(budgetMetrics.unallocatedCents) / 100,
                      )}`}
                </span>
              </summary>
              <ul className="budget-category-list">
                {sortedCategoryBudgets.map((entry) => (
                  <li
                    key={entry.categoryId}
                    className={entry.remainingCents < 0 ? 'is-over' : ''}
                  >
                    <CategoryIcon category={entry.category} size={14} compact />
                    <span className="budget-category-name">
                      {entry.category.name}
                    </span>
                    <span className="budget-category-value">
                      {formatMoney(entry.spentCents / 100, false)} /{' '}
                      {formatMoney(entry.budgetCents / 100, false)}
                    </span>
                    <span className="budget-category-meter" aria-hidden="true">
                      <span
                        style={{
                          width: `${Math.min(entry.ratio * 100, 100)}%`,
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          <div className="budget-foot">
            {remaining < 0 ? (
              <span className="budget-status is-over">
                生活支出已超出预算，接下来慢一点
              </span>
            ) : daysLeft > 0 ? (
              <span>
                还剩 <strong>{daysLeft}</strong> 天，月预算日均可用{' '}
                <strong>{formatMoney(dailyAllowance)}</strong>
              </span>
            ) : (
              <span>当月预算共 {formatMoney(budget)}</span>
            )}
            {projectExpense > 0 || countedProjectCount > 0 ? (
              <span className="budget-project-note">
                {projectExpense > 0
                  ? `独立核算的项目支出 ${formatMoney(projectExpense)} 不占生活预算`
                  : '计入日常的项目支出已并入生活预算'}
                {countedProjectCount > 0 && projectExpense > 0
                  ? '；计入日常的项目已并入生活预算。'
                  : '。'}
              </span>
            ) : null}
          </div>
        </section>
      </div>

      <RangeBudgetPanel metrics={rangeMetrics} onEdit={onOpenRangeBudget} />

      <BalanceSummary
        transactions={transactions}
        monthKey={monthKey}
        openingBalance={openingBalance}
        onAdjustOpeningBalance={onOpenOpeningBalance}
      />

      <section className="card metric-strip" aria-label="本月摘要">
        <div className="metric-item">
          <span className="metric-icon">
            <CalendarRange size={18} />
          </span>
          <div>
            <span className="metric-label">生活支出</span>
            <strong>{formatMoney(dailyExpense)}</strong>
            <small>
              日均 {formatMoney(dailyAverage)} ·{' '}
              {isCurrentMonth(monthKey)
                ? `按已过 ${elapsed} 天计算`
                : `按 ${elapsed} 天计算`}
            </small>
          </div>
        </div>
        <div className="metric-item">
          <span className="metric-icon">
            <CircleDollarSign size={18} />
          </span>
          <div>
            <span className="metric-label">项目支出</span>
            <strong>{formatMoney(projectExpense)}</strong>
            <small>
              {projectExpense > 0
                ? '独立核算部分按发生月份归集，不占生活预算'
                : countedProjectCount > 0
                  ? '计入日常的项目已并入生活支出'
                  : '本月还没有项目支出'}
            </small>
          </div>
        </div>
        <div className="metric-item">
          <span className="metric-icon">
            <ReceiptText size={18} />
          </span>
          <div>
            <span className="metric-label">记账笔数</span>
            <strong>{monthTransactions.length} 笔</strong>
            <small>
              支出 {expenseCount} 笔 · 收入 {incomeCount} 笔
            </small>
          </div>
        </div>
      </section>

      <div className="overview-main-grid">
        <article className="card chart-card">
          <div className="card-head">
            <div>
              <p className="card-kicker">LAST 6 MONTHS</p>
              <h2>支出趋势</h2>
              <p className="card-sub">
                从月度起伏里，看见消费的节奏。
                {isCurrentMonth(monthKey) ? ' 本月统计至今日。' : ''}
              </p>
            </div>
            <button
              type="button"
              className="text-link"
              onClick={() => onChangeView('analytics')}
            >
              查看统计
              <ArrowRight size={15} />
            </button>
          </div>
          <ExpenseTrendChart data={series} activeKey={monthKey} />
        </article>

        <article className="card category-card">
          <div className="card-head">
            <div>
              <p className="card-kicker">WHERE IT GOES</p>
              <h2>支出构成</h2>
              <p className="card-sub">
                {topCategory
                  ? `含项目在内，${topCategory.category.name}占了最大一块。`
                  : '这个月的支出还很轻盈。'}
              </p>
            </div>
          </div>
          <CategoryBars items={categories} limit={5} composition />
          {categories.length > 5 ? (
            <div className="category-card-foot">
              <span>另有 {categories.length - 5} 个分类未显示</span>
              <button
                type="button"
                className="text-link"
                onClick={() => onChangeView('analytics')}
              >
                全部明细
                <ArrowRight size={14} />
              </button>
            </div>
          ) : null}
        </article>
      </div>

      <section className="card recent-card" aria-labelledby="recent-heading">
        <div className="card-head">
          <div>
            <p className="card-kicker">RECENT ENTRIES</p>
            <h2 id="recent-heading">最近流水</h2>
          </div>
          <button
            type="button"
            className="text-link"
            onClick={() => onChangeView('transactions')}
          >
            查看全部
            <ArrowRight size={15} />
          </button>
        </div>

        {recent.length > 0 ? (
          <div className="recent-list">
            {recent.map((transaction) => (
              <TransactionRow
                key={transaction.id}
                transaction={transaction}
                projects={projects}
                onEdit={onEdit}
                onDelete={onDelete}
                showDate
                compact
              />
            ))}
          </div>
        ) : (
          <div className="empty-inline">
            <p>这个月还没有记下任何一笔。</p>
            <button type="button" className="button secondary" onClick={onAdd}>
              从第一笔开始
            </button>
          </div>
        )}
      </section>

      <BudgetAdjustDialog
        open={adjustOpen}
        monthKey={monthKey}
        metrics={budgetMetrics}
        onClose={() => setAdjustOpen(false)}
        onConfirm={(amountCents, note, rescheduleDaily) => {
          onBudgetAdjust(monthKey, amountCents, note, rescheduleDaily)
          setAdjustOpen(false)
        }}
      />
    </div>
  )
}
