import { ArrowRight, CalendarRange } from 'lucide-react'
import { formatMoney, formatPercent, localDateKey } from '../lib/utils'
import { formatRangeLabel, rangeTitle } from '../lib/budgetLabels'
import { getRangeBudgetWarnings } from '../lib/budget'
import type { BudgetWarning } from '../lib/budget'
import type { RangeBudgetMetrics } from '../types'

interface RangeBudgetPanelProps {
  metrics: RangeBudgetMetrics[]
  onEdit: () => void
  /** Tighter layout for the analytics page. */
  compact?: boolean
}

const TONE_RANK: Record<BudgetWarning['tone'], number> = {
  info: 0,
  warn: 1,
  danger: 2,
}

function mostUrgent(warnings: BudgetWarning[]): BudgetWarning | null {
  return warnings.reduce<BudgetWarning | null>(
    (top, warning) =>
      !top || TONE_RANK[warning.tone] > TONE_RANK[top.tone] ? warning : top,
    null,
  )
}

export function RangeBudgetPanel({
  metrics,
  onEdit,
  compact = false,
}: RangeBudgetPanelProps) {
  if (metrics.length === 0) return null
  const today = localDateKey()
  const sorted = [...metrics].sort(
    (left, right) =>
      Number(right.active) - Number(left.active) ||
      left.startDate.localeCompare(right.startDate) ||
      left.endDate.localeCompare(right.endDate),
  )

  return (
    <section
      className={`card range-budget-panel${compact ? ' is-compact' : ''}`}
      aria-labelledby="range-budget-panel-heading"
    >
      <div className="card-head">
        <div>
          <p className="card-kicker">RANGE BUDGETS</p>
          <h2 id="range-budget-panel-heading">区间预算</h2>
          <p className="card-sub">
            跨月按整段连续计算，既不拆分到各月，也不与月度预算互相校验。
          </p>
        </div>
        <button type="button" className="text-link" onClick={onEdit}>
          管理
          <ArrowRight size={15} />
        </button>
      </div>

      <ul className="range-budget-summary-list">
        {sorted.map((entry) => {
          const range = entry.range
          const statusKey = entry.active
            ? 'active'
            : today < range.startDate
              ? 'upcoming'
              : 'ended'
          const statusLabel =
            statusKey === 'active'
              ? '进行中'
              : statusKey === 'upcoming'
                ? '未开始'
                : '已结束'
          const warning = mostUrgent(
            entry.active ? getRangeBudgetWarnings(entry) : [],
          )
          const daily = entry.daily
          return (
            <li
              key={range.id}
              className={entry.active ? 'is-active' : ''}
            >
              <div className="range-budget-summary-head">
                <strong>
                  <CalendarRange size={14} />
                  {rangeTitle(range)}
                </strong>
                <em className={`range-budget-status is-${statusKey}`}>
                  {statusLabel}
                </em>
              </div>
              <span className="range-budget-summary-dates">
                {formatRangeLabel(range.startDate, range.endDate)} ·{' '}
                {entry.dayCount} 天
                {daily
                  ? daily.mode === 'auto'
                    ? ' · 每日自动均分'
                    : ' · 每日自定义'
                  : ''}
              </span>

              <div className="range-budget-summary-amounts">
                <span>
                  已用 {formatMoney(entry.spentCents / 100)}
                  <small> / {formatMoney(entry.amountCents / 100)}</small>
                </span>
                <strong className={entry.remainingCents < 0 ? 'is-negative' : ''}>
                  {entry.remainingCents < 0 ? '超出 ' : '剩余 '}
                  {formatMoney(Math.abs(entry.remainingCents) / 100)}
                </strong>
              </div>
              <div className="range-budget-summary-meter" aria-hidden="true">
                <span
                  className={entry.overBudget ? 'is-over' : ''}
                  style={{ width: `${Math.min(entry.ratio * 100, 100)}%` }}
                />
              </div>

              <div className="range-budget-summary-foot">
                <span>
                  已用 {formatPercent(entry.ratio * 100)}
                  {entry.active
                    ? ` · 还剩 ${entry.daysLeft} 天`
                    : entry.daysLeft === 0 && today > range.endDate
                      ? ' · 已结束'
                      : ' · 尚未开始'}
                </span>
                {entry.active && daily ? (
                  <span className={daily.overToday ? 'is-over' : ''}>
                    今日 {formatMoney(daily.todaySpentCents / 100, false)}
                    {daily.mode === 'auto'
                      ? ` / 额度 ${formatMoney(daily.todayBudgetCents / 100, false)}`
                      : ''}
                  </span>
                ) : null}
              </div>

              {warning ? (
                <p className={`range-budget-summary-alert is-${warning.tone}`}>
                  {warning.title}
                </p>
              ) : null}

              {!compact && entry.categories.length > 0 ? (
                <div className="range-budget-summary-categories">
                  {entry.categories.slice(0, 3).map((category) => (
                    <span
                      key={category.categoryId}
                      className={category.remainingCents < 0 ? 'is-over' : ''}
                    >
                      {category.category.name}{' '}
                      {formatMoney(category.spentCents / 100, false)}/
                      {formatMoney(category.budgetCents / 100, false)}
                    </span>
                  ))}
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
