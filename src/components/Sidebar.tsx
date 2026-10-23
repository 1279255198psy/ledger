import {
  CalendarRange,
  ChartNoAxesColumnIncreasing,
  CreditCard,
  Gauge,
  LayoutDashboard,
  Moon,
  Plus,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import { BrandMark } from './BrandMark'
import { rangeTitle } from '../lib/budgetLabels'
import {
  formatMoney,
  formatPercent,
  isCurrentMonth,
  monthShortLabel,
} from '../lib/utils'
import type {
  MonthBudgetMetrics,
  RangeBudgetMetrics,
  Theme,
  View,
} from '../types'

interface SidebarProps {
  view: View
  monthLabelText: string
  budgetMetrics: MonthBudgetMetrics
  rangeMetrics: RangeBudgetMetrics[]
  theme: Theme
  onChangeView: (view: View) => void
  onAdd: () => void
  onToggleTheme: () => void
  onOpenSettings: () => void
}

const NAV_ITEMS: Array<{
  id: View
  label: string
  icon: typeof LayoutDashboard
}> = [
  { id: 'overview', label: '概览', icon: LayoutDashboard },
  { id: 'transactions', label: '流水', icon: ReceiptText },
  { id: 'projects', label: '项目', icon: CalendarRange },
  { id: 'liabilities', label: '负债', icon: CreditCard },
  { id: 'analytics', label: '统计', icon: ChartNoAxesColumnIncreasing },
  { id: 'indices', label: '指数', icon: Gauge },
]

export function Sidebar({
  view,
  monthLabelText,
  budgetMetrics,
  rangeMetrics,
  theme,
  onChangeView,
  onAdd,
  onToggleTheme,
  onOpenSettings,
}: SidebarProps) {
  const expense = budgetMetrics.spentCents / 100
  const budget = budgetMetrics.amountCents / 100
  const ratio = budgetMetrics.ratio
  const width = Math.min(ratio * 100, 100)
  const overBudget = budgetMetrics.overBudget
  const daily = budgetMetrics.daily
  const showDaily = daily !== null && isCurrentMonth(budgetMetrics.monthKey)
  const activeRange = rangeMetrics.find((entry) => entry.active) ?? null
  const sourceTag =
    budgetMetrics.source === 'inherited' && budgetMetrics.sourceMonth
      ? `沿用 ${monthShortLabel(budgetMetrics.sourceMonth)}`
      : budgetMetrics.source === 'default'
        ? '默认'
        : null

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <BrandMark />
        </div>
        <div className="brand-copy">
          <span className="brand-name">账页</span>
          <span className="brand-caption">A QUIET LEDGER</span>
        </div>
      </div>

      <button type="button" className="sidebar-add" onClick={onAdd}>
        <Plus size={17} />
        记一笔
        <span className="sidebar-add-key" aria-hidden="true">
          N
        </span>
      </button>

      <nav className="sidebar-nav" aria-label="主导航">
        <p className="nav-label">账簿</p>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const active = view === item.id
          return (
            <button
              key={item.id}
              type="button"
              className={`nav-item${active ? ' is-active' : ''}`}
              onClick={() => onChangeView(item.id)}
              aria-current={active ? 'page' : undefined}
            >
              <Icon size={18} strokeWidth={1.8} />
              <span>{item.label}</span>
              {active ? <span className="nav-active-dot" aria-hidden /> : null}
            </button>
          )
        })}
      </nav>

      <div className="sidebar-spacer" />

      <section className="sidebar-budget" aria-label="本月生活预算概况">
        <div className="sidebar-budget-head">
          <span>{monthLabelText}生活预算</span>
          <strong>{formatPercent(Math.min(ratio * 100, 999))}</strong>
        </div>
        <div className="mini-meter" aria-hidden="true">
          <span
            className={overBudget ? 'is-over' : ''}
            style={{ width: `${width}%` }}
          />
        </div>
        <p>
          已用 {formatMoney(expense, false)} / {formatMoney(budget, false)}
          {sourceTag ? <span className="sidebar-budget-tag">{sourceTag}</span> : null}
        </p>
        {showDaily ? (
          <div
            className={`sidebar-daily${daily.overToday ? ' is-over' : ''}`}
          >
            <span>
              今日 {formatMoney(daily.todaySpentCents / 100, false)} /{' '}
              {formatMoney(daily.todayBudgetCents / 100, false)}
            </span>
            <span>
              {daily.mode === 'auto' ? '自动均分' : '自定义'}
            </span>
          </div>
        ) : null}
        {activeRange ? (
          <div
            className={`sidebar-range${activeRange.overBudget ? ' is-over' : ''}`}
          >
            <span>{rangeTitle(activeRange.range)}</span>
            <span>
              {formatPercent(Math.min(activeRange.ratio * 100, 999))} · 剩{' '}
              {activeRange.daysLeft} 天
            </span>
          </div>
        ) : null}
      </section>

      <div className="sidebar-footer">
        <div className="sidebar-utility">
          <button
            type="button"
            className="sidebar-icon-button"
            onClick={onToggleTheme}
            aria-label={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
            title={theme === 'light' ? '深色模式' : '浅色模式'}
          >
            {theme === 'light' ? <Moon size={17} /> : <Sun size={17} />}
          </button>
          <button
            type="button"
            className="sidebar-icon-button"
            onClick={onOpenSettings}
            aria-label="设置与数据管理"
            title="设置与数据管理"
          >
            <Settings size={17} />
          </button>
        </div>
        <p className="local-note">
          <ShieldCheck size={13} />
          数据仅存于此设备
        </p>
      </div>
    </aside>
  )
}
