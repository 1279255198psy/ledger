import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Settings,
} from 'lucide-react'
import { currentMonthKey, formatFullDate } from '../lib/utils'
import type { View } from '../types'

interface TopBarProps {
  view: View
  monthKey: string
  onMonthShift: (delta: number) => void
  onThisMonth: () => void
  onAdd: () => void
  onOpenSettings: () => void
}

const PAGE_META: Record<View, { title: string; subtitle: string }> = {
  overview: { title: '概览', subtitle: '钱花在哪里，日子就长成什么样。' },
  transactions: { title: '流水', subtitle: '每一笔，都有迹可循。' },
  projects: { title: '项目', subtitle: '在日历上铺开一段时间，把花销归到一处。' },
  analytics: { title: '统计', subtitle: '从数字里，读懂生活的方向。' },
}

export function TopBar({
  view,
  monthKey,
  onMonthShift,
  onThisMonth,
  onAdd,
  onOpenSettings,
}: TopBarProps) {
  const meta = PAGE_META[view]
  const isThisMonth = monthKey === currentMonthKey()
  const [year, month] = monthKey.split('-').map(Number)
  const atCurrentMonth = monthKey >= currentMonthKey()

  return (
    <header className="topbar">
      <div className="page-heading">
        <p className="eyebrow">{formatFullDate()}</p>
        <div className="page-title-row">
          <h1>{meta.title}</h1>
          <p>{meta.subtitle}</p>
        </div>
      </div>

      <div className="topbar-actions">
        {view !== 'projects' ? (
          <>
            <div className="month-switcher">
              <button
                type="button"
                className="month-arrow"
                onClick={() => onMonthShift(-1)}
                aria-label="上个月"
              >
                <ChevronLeft size={17} />
              </button>
              <span className="month-value" aria-live="polite">
                {year}年{month}月
                {isThisMonth ? <em>本月</em> : null}
              </span>
              <button
                type="button"
                className="month-arrow"
                onClick={() => onMonthShift(1)}
                aria-label="下个月"
                disabled={atCurrentMonth}
              >
                <ChevronRight size={17} />
              </button>
            </div>
            {!isThisMonth ? (
              <button
                type="button"
                className="this-month-link"
                onClick={onThisMonth}
              >
                回本月
              </button>
            ) : null}
          </>
        ) : null}
        <button
          type="button"
          className="icon-button settings-trigger"
          onClick={onOpenSettings}
          aria-label="设置与数据管理"
        >
          <Settings size={18} />
        </button>
        <button type="button" className="button primary add-button" onClick={onAdd}>
          <Plus size={17} />
          记一笔
        </button>
      </div>
    </header>
  )
}
