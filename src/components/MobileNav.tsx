import {
  CalendarRange,
  ChartNoAxesColumnIncreasing,
  CreditCard,
  Gauge,
  LayoutDashboard,
  ReceiptText,
} from 'lucide-react'
import type { View } from '../types'

interface MobileNavProps {
  view: View
  onChangeView: (view: View) => void
}

const ITEMS: Array<{ id: View; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: '概览', icon: LayoutDashboard },
  { id: 'transactions', label: '流水', icon: ReceiptText },
  { id: 'projects', label: '项目', icon: CalendarRange },
  { id: 'liabilities', label: '负债', icon: CreditCard },
  { id: 'analytics', label: '统计', icon: ChartNoAxesColumnIncreasing },
  { id: 'indices', label: '指数', icon: Gauge },
]

export function MobileNav({ view, onChangeView }: MobileNavProps) {
  return (
    <nav className="mobile-nav" aria-label="移动端主导航">
      {ITEMS.map((item) => {
        const Icon = item.icon
        return (
          <button
            key={item.id}
            type="button"
            className={view === item.id ? 'is-active' : ''}
            onClick={() => onChangeView(item.id)}
            aria-current={view === item.id ? 'page' : undefined}
          >
            <Icon size={20} strokeWidth={1.8} />
            <span>{item.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
