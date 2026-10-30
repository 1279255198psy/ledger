import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  CalendarRange,
  PiggyBank,
  PieChart,
  ReceiptText,
  Target,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { DailyExpenseChart } from '../components/charts/DailyExpenseChart'
import { IncomeExpenseChart } from '../components/charts/IncomeExpenseChart'
import { CategoryBars } from '../components/charts/CategoryBars'
import { EmptyLedger } from '../components/EmptyLedger'
import { RangeBudgetPanel } from '../components/RangeBudgetPanel'
import {
  getCountedProjectIds,
  getMonthSpendCents,
  getProjectMonthRows,
  getProjectSummary,
} from '../lib/allocations'
import {
  buildDailyExpenses,
  buildMonthPairSeries,
  daysElapsedInMonth,
  daysInMonthOfKey,
  formatMoney,
  formatPercent,
  formatShortDate,
  getCategoryTotals,
  getMonthTransactions,
  getTotals,
  isCurrentMonth,
  largestExpense,
  monthLabel,
  percentChange,
  projectCoversMonth,
  projectMonthlySpend,
  shiftMonth,
  topWeekdaySpending,
} from '../lib/utils'
import { getCategory } from '../lib/data'
import {
  formatAdjustmentTime,
  summarizeAdjustments,
} from '../lib/budgetLabels'
import type {
  LedgerTransaction,
  MonthBudgetMetrics,
  Project,
  RangeBudgetMetrics,
  View,
} from '../types'

interface AnalyticsProps {
  transactions: LedgerTransaction[]
  projects: Project[]
  monthKey: string
  budgetMetrics: MonthBudgetMetrics
  rangeMetrics: RangeBudgetMetrics[]
  onAdd: () => void
  onChangeView: (view: View) => void
  onOpenBudget: () => void
  onOpenRangeBudget: () => void
  onLoadSample: () => void
}

function StatDelta({
  value,
  goodWhenUp,
  label = '较上月同期',
}: {
  value: number | null
  goodWhenUp: boolean
  label?: string
}) {
  if (value === null) {
    return <span className="stat-delta is-neutral">上月暂无数据</span>
  }
  const up = value >= 0
  const good = up === goodWhenUp
  return (
    <span className={`stat-delta ${good ? 'is-good' : 'is-warn'}`}>
      {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
      {formatPercent(Math.abs(value), 1)}
      <span className="stat-delta-label">{label}</span>
    </span>
  )
}

export function Analytics({
  transactions,
  projects,
  monthKey,
  budgetMetrics,
  rangeMetrics,
  onAdd,
  onChangeView,
  onOpenBudget,
  onOpenRangeBudget,
  onLoadSample,
}: AnalyticsProps) {
  if (transactions.length === 0) {
    return (
      <div className="page-stack analytics-page">
        <EmptyLedger onAdd={onAdd} onLoadSample={onLoadSample} />
      </div>
    )
  }

  const monthTransactions = getMonthTransactions(transactions, monthKey)
  const totals = getTotals(monthTransactions)
  const countedProjectIds = getCountedProjectIds(projects)
  const spend = getMonthSpendCents(transactions, monthKey, countedProjectIds)
  const dailyExpense = spend.dailyCents / 100
  const projectExpense = spend.projectCents / 100
  const budget = budgetMetrics.amountCents / 100
  const daily = budgetMetrics.daily
  const adjustments = budgetMetrics.adjustments
  const adjustmentSummary = summarizeAdjustments(adjustments)
  const isCurrent = isCurrentMonth(monthKey)
  const sortedCategoryBudgets = [...budgetMetrics.categories].sort(
    (left, right) => right.ratio - left.ratio,
  )
  const categories = getCategoryTotals(monthTransactions, 'expense')
  const previousKey = shiftMonth(monthKey, -1)
  const elapsed = Math.max(daysElapsedInMonth(monthKey), 1)
  const cutoff = isCurrentMonth(monthKey) ? new Date().getDate() : 31
  const previousTransactions = getMonthTransactions(
    transactions,
    previousKey,
  ).filter((item) => Number(item.date.slice(8, 10)) <= cutoff)
  const previousTotals = getTotals(previousTransactions)
  const previousSpend = getMonthSpendCents(
    previousTransactions,
    previousKey,
    countedProjectIds,
  )

  const incomeChange = percentChange(totals.income, previousTotals.income)
  const expenseChange = percentChange(totals.expense, previousTotals.expense)
  const dailyAverage = dailyExpense / elapsed
  const previousDayCount = isCurrentMonth(monthKey)
    ? cutoff
    : daysInMonthOfKey(previousKey)
  const previousDailyAverage =
    previousSpend.dailyCents / 100 / Math.max(previousDayCount, 1)
  const dailyChange = percentChange(dailyAverage, previousDailyAverage)
  const balanceRate =
    totals.income > 0 ? (totals.balance / totals.income) * 100 : 0
  const comparisonLabel = isCurrentMonth(monthKey) ? '较上月同期' : '较上月'

  const pairSeries = buildMonthPairSeries(transactions, monthKey, 6)
  const dailyData = buildDailyExpenses(
    transactions,
    monthKey,
    'daily',
    countedProjectIds,
  ).slice(
    0,
    Math.min(elapsed, 31),
  )
  const projection = projectMonthlySpend(dailyExpense, monthKey)
  const biggest = largestExpense(monthTransactions)
  const topCategory = categories[0]
  const activeDays = dailyData.filter((item) => item.value > 0).length
  const peakDay = dailyData.reduce(
    (peak, item) => (item.value > peak.value ? item : peak),
    dailyData[0] ?? { day: 1, value: 0 },
  )
  const costlyWeekday = topWeekdaySpending(monthTransactions)
  const projectedOverBudget = projection > budget
  const topCategoryText = topCategory
    ? `${topCategory.category.name}占本月支出的 ${formatPercent(topCategory.share * 100)}`
    : '还没有形成支出结构'

  const monthProjectRows = new Map(
    getProjectMonthRows(transactions, monthKey).map((row) => [
      row.projectId,
      row,
    ]),
  )
  const projectReports = projects
    // 项目账单只跟着项目自己的起止日期走：本月不在项目周期里的旧项目
    // 即使还有流水，也不应混进本月的账单；跨月项目会在每个月出现。
    .filter((project) => projectCoversMonth(project, monthKey))
    .map((project) => ({
      project,
      summary: getProjectSummary(transactions, project.id),
      monthRow: monthProjectRows.get(project.id),
    }))
    .filter(
      (item) =>
        item.summary.totalExpenseCents > 0 ||
        item.summary.totalIncomeCents > 0 ||
        (!item.project.archivedAt && item.project.status === 'active'),
    )
    .sort(
      (left, right) =>
        (right.monthRow?.monthExpenseCents ?? 0) -
          (left.monthRow?.monthExpenseCents ?? 0) ||
        right.summary.totalExpenseCents -
          left.summary.totalExpenseCents,
    )
  const monthProjectCents = projectReports.reduce(
    (sum, item) => sum + (item.monthRow?.monthExpenseCents ?? 0),
    0,
  )

  return (
    <div className="page-stack analytics-page">
      <section className="analytics-kpis" aria-label="月度关键指标">
        <article className="card kpi-card">
          <span className="kpi-icon is-income">
            <ArrowDownLeft size={18} />
          </span>
          <p className="kpi-label">本月收入</p>
          <strong className="kpi-value">{formatMoney(totals.income)}</strong>
          <StatDelta
            value={incomeChange}
            goodWhenUp
            label={comparisonLabel}
          />
        </article>

        <article className="card kpi-card">
          <span className="kpi-icon is-expense">
            <ArrowUpRight size={18} />
          </span>
          <p className="kpi-label">本月支出总额</p>
          <strong className="kpi-value">{formatMoney(totals.expense)}</strong>
          <StatDelta
            value={expenseChange}
            goodWhenUp={false}
            label={comparisonLabel}
          />
          <span className="kpi-note">
            生活 {formatMoney(dailyExpense)} · 项目{' '}
            {formatMoney(projectExpense)}
          </span>
        </article>

        <article className="card kpi-card">
          <span className="kpi-icon is-balance">
            <PiggyBank size={18} />
          </span>
          <p className="kpi-label">结余率</p>
          <strong className="kpi-value">
            {totals.income > 0 ? formatPercent(balanceRate) : '—'}
          </strong>
          <span className="kpi-note">
            {totals.income > 0
              ? totals.balance >= 0
                ? `每 100 元收入，留下 ${Math.round(balanceRate)} 元`
                : '本月支出超过了收入'
              : '有收入后才会计算结余率'}
          </span>
        </article>

        <article className="card kpi-card">
          <span className="kpi-icon is-daily">
            <CalendarRange size={18} />
          </span>
          <p className="kpi-label">日均生活支出</p>
          <strong className="kpi-value">{formatMoney(dailyAverage)}</strong>
          <StatDelta
            value={dailyChange}
            goodWhenUp={false}
            label={comparisonLabel}
          />
          {daily && isCurrent ? (
            <span
              className={`kpi-note${daily.overToday ? ' is-warn' : ''}`}
            >
              今日 {formatMoney(daily.todaySpentCents / 100)} / 额度{' '}
              {formatMoney(daily.todayBudgetCents / 100)}
            </span>
          ) : null}
        </article>
      </section>

      <article className="card chart-card chart-card--wide">
        <div className="card-head">
          <div>
            <p className="card-kicker">INCOME &amp; EXPENSE</p>
            <h2>收支对照</h2>
            <p className="card-sub">
              每一根柱子，都是一个月的生活切面。
            </p>
          </div>
          <span className="chart-scope">
            {monthLabel(monthKey)} · 近 6 个月
            {isCurrentMonth(monthKey) ? ' · 本月至今' : ''}
          </span>
        </div>
        <IncomeExpenseChart data={pairSeries} />
      </article>

      <div className="analytics-split">
        <article className="card chart-card daily-card">
          <div className="card-head">
            <div>
              <p className="card-kicker">DAY BY DAY</p>
              <h2>每日生活支出</h2>
              <p className="card-sub">
                统计日常归属，以及设为「计入日常」的项目花费；其余项目按发生月份另行归集。
              </p>
            </div>
            <span className="chart-scope">悬停查看 · 方向键浏览</span>
          </div>
          <DailyExpenseChart data={dailyData} monthKey={monthKey} />
          <div className="daily-foot">
            <div>
              <span>有支出的日子</span>
              <strong>
                {activeDays} / {dailyData.length} 天
              </strong>
            </div>
            <div>
              <span>单日最高</span>
              <strong>
                {peakDay.value > 0
                  ? `${formatMoney(peakDay.value)} · ${peakDay.day}日`
                  : '—'}
              </strong>
            </div>
            {daily && isCurrent ? (
              <div>
                <span>今日额度</span>
                <strong className={daily.overToday ? 'is-negative' : ''}>
                  {formatMoney(daily.todaySpentCents / 100)} /{' '}
                  {formatMoney(daily.todayBudgetCents / 100)}
                </strong>
              </div>
            ) : null}
          </div>
        </article>

        <article className="card category-card category-card--full">
          <div className="card-head">
            <div>
              <p className="card-kicker">CATEGORY RANKING</p>
              <h2>分类排行</h2>
              <p className="card-sub">{topCategoryText}。</p>
            </div>
          </div>
          <CategoryBars
            items={categories}
            transactions={monthTransactions}
          />
          <div className="category-total">
            <span>本月支出合计</span>
            <strong>{formatMoney(totals.expense)}</strong>
          </div>
          {sortedCategoryBudgets.length > 0 ? (
            <div className="analytics-category-budgets">
              <div className="analytics-category-budget-head">
                <span>分类预算进度</span>
                <button
                  type="button"
                  className="text-link"
                  onClick={onOpenBudget}
                >
                  调整预算
                </button>
              </div>
              <ul>
                {sortedCategoryBudgets.map((entry) => (
                  <li
                    key={entry.categoryId}
                    className={entry.remainingCents < 0 ? 'is-over' : ''}
                  >
                    <span className="analytics-category-budget-name">
                      {entry.category.name}
                    </span>
                    <span className="analytics-category-budget-value">
                      {formatMoney(entry.spentCents / 100, false)} /{' '}
                      {formatMoney(entry.budgetCents / 100, false)}
                    </span>
                    <span
                      className="analytics-category-budget-meter"
                      aria-hidden="true"
                    >
                      <span
                        style={{
                          width: `${Math.min(entry.ratio * 100, 100)}%`,
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>
      </div>

      {adjustments.length > 0 ? (
        <article className="card budget-adjust-card" aria-labelledby="budget-adjust-heading">
          <div className="card-head">
            <div>
              <p className="card-kicker">BUDGET CHANGES</p>
              <h2 id="budget-adjust-heading">预算调整记录</h2>
              <p className="card-sub">
                原定预算{' '}
                {formatMoney(budgetMetrics.baseAmountCents / 100)}
                ，本月在执行中调整了 {adjustments.length} 次。
              </p>
            </div>
            <span
              className={`budget-adjust-net${
                adjustmentSummary.netCents > 0
                  ? ' is-up'
                  : adjustmentSummary.netCents < 0
                    ? ' is-down'
                    : ''
              }`}
            >
              {adjustmentSummary.netCents === 0
                ? '净变化'
                : adjustmentSummary.netCents > 0
                  ? '净上调'
                  : '净下调'}{' '}
              {formatMoney(Math.abs(adjustmentSummary.netCents) / 100)}
            </span>
          </div>

          <div className="budget-adjust-stats">
            <span>
              <em>上调</em>
              <strong>{adjustmentSummary.up} 次</strong>
            </span>
            <span>
              <em>下调</em>
              <strong>{adjustmentSummary.down} 次</strong>
            </span>
            <span>
              <em>当前预算</em>
              <strong>{formatMoney(budgetMetrics.amountCents / 100)}</strong>
            </span>
          </div>

          <ul className="budget-adjust-log">
            {[...adjustments].reverse().map((entry) => (
              <li key={entry.id}>
                <span className="budget-adjust-time">
                  {formatAdjustmentTime(entry.at)}
                </span>
                <span className="budget-adjust-flow">
                  {formatMoney(entry.beforeCents / 100, false)} →{' '}
                  {formatMoney(entry.afterCents / 100, false)}
                </span>
                <em className={entry.deltaCents > 0 ? 'is-up' : 'is-down'}>
                  {entry.deltaCents > 0 ? '上调' : '下调'}{' '}
                  {formatMoney(Math.abs(entry.deltaCents) / 100, false)}
                </em>
                <small>
                  {entry.note || '未填写原因'}
                  {entry.kind === 'replan' ? ' · 重新制定' : ''}
                </small>
              </li>
            ))}
          </ul>
        </article>
      ) : null}

      <RangeBudgetPanel
        metrics={rangeMetrics}
        onEdit={onOpenRangeBudget}
        compact
      />

      {projectReports.length > 0 ? (
        <section
          className="project-report"
          aria-labelledby="project-report-heading"
        >
          <div className="section-heading">
            <div>
              <p className="card-kicker">PROJECT LEDGER</p>
              <h2 id="project-report-heading">项目账单</h2>
              <p>
                只列出起止日期覆盖本月的项目，跨月项目会在涉及的每个月出现；
                总额跨月保留，月度数字按交易发生日期归集。独立核算的项目不占生活预算，
                计入日常的项目同时算在生活支出里。
              </p>
            </div>
            <span className="chart-scope">
              {monthLabel(monthKey)} · 归集 {formatMoney(monthProjectCents / 100)}
            </span>
          </div>

          <div className="project-report-list">
            {projectReports.map(({ project, summary, monthRow }) => {
              const status = project.archivedAt
                ? 'archived'
                : project.status === 'active'
                  ? 'active'
                  : 'closed'
              const statusLabel =
                status === 'archived'
                  ? '已归档'
                  : status === 'active'
                    ? '进行中'
                    : '已结束'
              const budgetCents = project.budgetCents
              const usedRatio =
                budgetCents && budgetCents > 0
                  ? summary.totalExpenseCents / budgetCents
                  : 0
              const remainingCents =
                (budgetCents ?? 0) - summary.totalExpenseCents

              return (
                <article
                  className="card project-report-card"
                  key={project.id}
                >
                  <div className="project-report-head">
                    <div className="project-report-title">
                      <h3>{project.name}</h3>
                      <span className={`project-status is-${status}`}>
                        {statusLabel}
                      </span>
                    </div>
                    <div className="project-report-total">
                      <span>项目总支出</span>
                      <strong>
                        {formatMoney(summary.totalExpenseCents / 100)}
                      </strong>
                    </div>
                  </div>

                  <div className="project-report-metrics">
                    <div>
                      <span>本月归集</span>
                      <strong>
                        {formatMoney(
                          (monthRow?.monthExpenseCents ?? 0) / 100,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>截至本月累计</span>
                      <strong>
                        {formatMoney(
                          (monthRow?.cumulativeExpenseCents ?? 0) / 100,
                        )}
                      </strong>
                    </div>
                    <div>
                      <span>项目收入</span>
                      <strong className="is-income">
                        {formatMoney(summary.totalIncomeCents / 100)}
                      </strong>
                    </div>
                  </div>

                  {budgetCents ? (
                    <div className="project-budget">
                      <div className="project-budget-head">
                        <span>项目预算</span>
                        <span className={remainingCents < 0 ? 'is-over' : ''}>
                          {formatPercent(usedRatio * 100)} ·{' '}
                          {remainingCents < 0 ? '超出' : '剩余'}{' '}
                          {formatMoney(Math.abs(remainingCents) / 100)}
                        </span>
                      </div>
                      <div className="project-budget-meter">
                        <span
                          className={remainingCents < 0 ? 'is-over' : ''}
                          style={{
                            width: `${Math.min(usedRatio * 100, 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ) : null}

                  {summary.byMonth.length > 0 ? (
                    <details className="project-months">
                      <summary>
                        月度归集 · {summary.byMonth.length} 个月
                      </summary>
                      <div className="project-month-list">
                        {summary.byMonth.map((month) => (
                          <div
                            className="project-month-row"
                            key={month.month}
                          >
                            <span>{monthLabel(month.month)}</span>
                            <strong>
                              {formatMoney(month.expenseCents / 100)}
                            </strong>
                            <small>
                              累计{' '}
                              {formatMoney(
                                month.cumulativeExpenseCents / 100,
                              )}
                            </small>
                          </div>
                        ))}
                      </div>
                    </details>
                  ) : null}
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      <section className="insights-section" aria-labelledby="insights-heading">
        <div className="section-heading">
          <div>
            <p className="card-kicker">MONTHLY NOTES</p>
            <h2 id="insights-heading">这个月的消费手记</h2>
            <p>从流水里打捞出的四件小事。</p>
          </div>
          <button
            type="button"
            className="button ghost"
            onClick={() => onChangeView('transactions')}
          >
            翻看流水
          </button>
        </div>

        <div className="insight-grid">
          <article className="card insight-card">
            <span className="insight-icon">
              <PieChart size={18} />
            </span>
            <p className="insight-label">支出重心</p>
            <strong>
              {topCategory
                ? formatMoney(topCategory.value)
                : formatMoney(0)}
            </strong>
            <p className="insight-copy">
              {topCategory
                ? `${topCategory.category.name}是本月最大的支出分类，占 ${formatPercent(topCategory.share * 100)}。`
                : '这个月还没有支出，账页很安静。'}
            </p>
          </article>

          <article className="card insight-card">
            <span className="insight-icon">
              <Target size={18} />
            </span>
            <p className="insight-label">
              {isCurrentMonth(monthKey) ? '月末生活预计' : '当月生活实际'}
            </p>
            <strong>{formatMoney(projection)}</strong>
            <p className="insight-copy">
              {isCurrentMonth(monthKey)
                ? `按当前节奏，预计${projectedOverBudget ? '超出' : '低于'}预算 ${formatMoney(Math.abs(projection - budget))}。`
                : `当月生活支出占预算的 ${formatPercent((dailyExpense / budget) * 100)}。`}
              <span
                className={`insight-chip ${projectedOverBudget ? 'is-warn' : 'is-good'}`}
              >
                {projectedOverBudget ? '需要留意' : '预算内'}
              </span>
            </p>
          </article>

          <article className="card insight-card">
            <span className="insight-icon">
              <CalendarDays size={18} />
            </span>
            <p className="insight-label">最费钱的星期</p>
            <strong>{costlyWeekday?.label ?? '—'}</strong>
            <p className="insight-copy">
              {costlyWeekday
                ? `${costlyWeekday.label}共支出 ${formatMoney(costlyWeekday.value)}，是这一周里最热闹的一天。`
                : '还没有足够的数据来找出规律。'}
            </p>
          </article>

          <article className="card insight-card">
            <span className="insight-icon">
              <ReceiptText size={18} />
            </span>
            <p className="insight-label">最大单笔</p>
            <strong>
              {biggest ? formatMoney(biggest.amountCents / 100) : '—'}
            </strong>
            <p className="insight-copy">
              {biggest
                ? `${getCategory(biggest.categoryId, biggest.type).name} · ${biggest.note || formatShortDate(biggest.date)}`
                : '等第一笔记录来填满这里。'}
            </p>
          </article>
        </div>
      </section>

      {monthTransactions.length === 0 ? (
        <div className="empty-callout">
          <p>这个月还没有流水，统计会随着第一笔记录慢慢长出来。</p>
          <button type="button" className="button secondary" onClick={onAdd}>
            记下第一笔
          </button>
        </div>
      ) : null}
    </div>
  )
}
