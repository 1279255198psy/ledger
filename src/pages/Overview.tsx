import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  CalendarRange,
  CircleDollarSign,
  PencilLine,
  ReceiptText,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { BalanceSummary } from '../components/BalanceSummary'
import { CategoryBars } from '../components/charts/CategoryBars'
import { activeCurrencySymbol } from '../lib/currency'
import { EmptyLedger } from '../components/EmptyLedger'
import { ExpenseTrendChart } from '../components/charts/ExpenseTrendChart'
import { TransactionRow } from '../components/TransactionRow'
import { getMonthSpendCents } from '../lib/allocations'
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
  percentChange,
  shiftMonth,
} from '../lib/utils'
import type { LedgerTransaction, Project, View } from '../types'

interface OverviewProps {
  transactions: LedgerTransaction[]
  projects: Project[]
  monthKey: string
  budget: number
  openingBalance: number
  onAdd: () => void
  onEdit: (transaction: LedgerTransaction) => void
  onDelete: (id: string) => void
  onChangeView: (view: View) => void
  onOpenBudget: () => void
  onLoadSample: () => void
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
  monthKey,
  budget,
  openingBalance,
  onAdd,
  onEdit,
  onDelete,
  onChangeView,
  onOpenBudget,
  onLoadSample,
}: OverviewProps) {
  if (transactions.length === 0) {
    return (
      <div className="page-stack overview-page">
        <BalanceSummary
          transactions={transactions}
          monthKey={monthKey}
          openingBalance={openingBalance}
          onAdjustOpeningBalance={onOpenBudget}
        />
        <EmptyLedger onAdd={onAdd} onLoadSample={onLoadSample} />
      </div>
    )
  }

  const monthTransactions = getMonthTransactions(transactions, monthKey)
  const totals = getTotals(monthTransactions)
  const spend = getMonthSpendCents(transactions, monthKey)
  const dailyExpense = spend.dailyCents / 100
  const projectExpense = spend.projectCents / 100
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
    .reduce((sum, item) => sum + item.amountCents / 100, 0)
  const expenseChange = percentChange(totals.expense, previousComparableExpense)
  const comparisonLabel = isCurrentMonth(monthKey) ? '较上月同期' : '较上月'
  const elapsed = Math.max(daysElapsedInMonth(monthKey), 1)
  const dailyAverage = dailyExpense / elapsed
  const topCategory = categories[0]
  const remaining = budget - dailyExpense
  const ratio = budget > 0 ? dailyExpense / budget : 0
  const daysLeft = getDaysLeft(monthKey)
  const dailyAllowance = daysLeft > 0 ? Math.max(remaining, 0) / daysLeft : 0
  const recent = [...monthTransactions].slice(0, 6)
  const expenseCount = monthTransactions.filter(
    (item) => item.type === 'expense',
  ).length
  const incomeCount = monthTransactions.length - expenseCount
  const series = buildMonthSeries(transactions, monthKey, 6, 'expense')

  return (
    <div className="page-stack overview-page">
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
              <p className="card-kicker">MONTHLY BUDGET</p>
              <h2 id="budget-heading">
                {isCurrentMonth(monthKey) ? '本月生活预算' : '当月生活预算'}
              </h2>
            </div>
            <button
              type="button"
              className="icon-button icon-button--small"
              onClick={onOpenBudget}
              aria-label="调整预算"
              title="调整预算"
            >
              <PencilLine size={16} />
            </button>
          </div>

          <div className="budget-figure">
            <strong>{formatPercent(ratio * 100)}</strong>
            <span>生活支出占比</span>
          </div>

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

          <div className="budget-foot">
            {remaining < 0 ? (
              <span className="budget-status is-over">
                生活支出已超出预算，接下来慢一点
              </span>
            ) : daysLeft > 0 ? (
              <span>
                还剩 <strong>{daysLeft}</strong> 天，日均可用{' '}
                <strong>{formatMoney(dailyAllowance)}</strong>
              </span>
            ) : (
              <span>当月预算共 {formatMoney(budget)}</span>
            )}
            {projectExpense > 0 ? (
              <span className="budget-project-note">
                项目支出 {formatMoney(projectExpense)} 单独归集，不占生活预算。
              </span>
            ) : null}
          </div>
        </section>
      </div>

      <BalanceSummary
        transactions={transactions}
        monthKey={monthKey}
        openingBalance={openingBalance}
        onAdjustOpeningBalance={onOpenBudget}
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
                ? '本月按发生月份归集，不占生活预算'
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
    </div>
  )
}
