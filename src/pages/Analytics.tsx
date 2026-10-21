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
  projectMonthlySpend,
  shiftMonth,
  topWeekdaySpending,
} from '../lib/utils'
import { getCategory } from '../lib/data'
import type { LedgerTransaction, View } from '../types'

interface AnalyticsProps {
  transactions: LedgerTransaction[]
  monthKey: string
  budget: number
  onAdd: () => void
  onChangeView: (view: View) => void
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
  monthKey,
  budget,
  onAdd,
  onChangeView,
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
  const categories = getCategoryTotals(monthTransactions, 'expense')
  const previousKey = shiftMonth(monthKey, -1)
  const elapsed = Math.max(daysElapsedInMonth(monthKey), 1)
  const cutoff = isCurrentMonth(monthKey) ? new Date().getDate() : 31
  const previousTransactions = getMonthTransactions(
    transactions,
    previousKey,
  ).filter((item) => Number(item.date.slice(8, 10)) <= cutoff)
  const previousTotals = getTotals(previousTransactions)

  const incomeChange = percentChange(totals.income, previousTotals.income)
  const expenseChange = percentChange(totals.expense, previousTotals.expense)
  const dailyAverage = totals.expense / elapsed
  const previousDayCount = isCurrentMonth(monthKey)
    ? cutoff
    : daysInMonthOfKey(previousKey)
  const previousDailyAverage =
    previousTotals.expense / Math.max(previousDayCount, 1)
  const dailyChange = percentChange(dailyAverage, previousDailyAverage)
  const balanceRate =
    totals.income > 0 ? (totals.balance / totals.income) * 100 : 0
  const comparisonLabel = isCurrentMonth(monthKey) ? '较上月同期' : '较上月'

  const pairSeries = buildMonthPairSeries(transactions, monthKey, 6)
  const dailyData = buildDailyExpenses(transactions, monthKey).slice(
    0,
    Math.min(elapsed, 31),
  )
  const projection = projectMonthlySpend(totals.expense, monthKey)
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
          <p className="kpi-label">本月支出</p>
          <strong className="kpi-value">{formatMoney(totals.expense)}</strong>
          <StatDelta
            value={expenseChange}
            goodWhenUp={false}
            label={comparisonLabel}
          />
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
          <p className="kpi-label">日均支出</p>
          <strong className="kpi-value">{formatMoney(dailyAverage)}</strong>
          <StatDelta
            value={dailyChange}
            goodWhenUp={false}
            label={comparisonLabel}
          />
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
              <h2>每日支出</h2>
              <p className="card-sub">看看这个月的钱，落在哪些日子。</p>
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
          <CategoryBars items={categories} />
          <div className="category-total">
            <span>本月支出合计</span>
            <strong>{formatMoney(totals.expense)}</strong>
          </div>
        </article>
      </div>

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
              {isCurrentMonth(monthKey) ? '月末预计' : '当月实际'}
            </p>
            <strong>{formatMoney(projection)}</strong>
            <p className="insight-copy">
              {isCurrentMonth(monthKey)
                ? `按当前节奏，预计${projectedOverBudget ? '超出' : '低于'}预算 ${formatMoney(Math.abs(projection - budget))}。`
                : `当月支出占预算的 ${formatPercent((totals.expense / budget) * 100)}。`}
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
            <strong>{biggest ? formatMoney(biggest.amount) : '—'}</strong>
            <p className="insight-copy">
              {biggest
                ? `${getCategory(biggest.categoryId).name} · ${biggest.note || formatShortDate(biggest.date)}`
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
