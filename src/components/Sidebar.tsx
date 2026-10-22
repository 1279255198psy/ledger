import {
  ChartNoAxesColumnIncreasing,
  LayoutDashboard,
  Moon,
  Plus,
  ReceiptText,
  Settings,
  ShieldCheck,
  Sun,
} from 'lucide-react'
import { BrandMark } from './BrandMark'
import { formatMoney, formatPercent } from '../lib/utils'
import type { Theme, View } from '../types'

interface SidebarProps {
  view: View
  monthLabelText: string
  expense: number
  budget: number
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
  { id: 'analytics', label: '统计', icon: ChartNoAxesColumnIncreasing },
]

export function Sidebar({
  view,
  monthLabelText,
  expense,
  budget,
  theme,
  onChangeView,
  onAdd,
  onToggleTheme,
  onOpenSettings,
}: SidebarProps) {
  const ratio = budget > 0 ? expense / budget : 0
  const width = Math.min(ratio * 100, 100)
  const overBudget = expense > budget

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
        </p>
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
