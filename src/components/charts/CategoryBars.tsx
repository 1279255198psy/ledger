import { CategoryIcon } from '../CategoryIcon'
import { formatMoney, formatPercent } from '../../lib/utils'
import type { CategoryTotal } from '../../types'

interface CategoryBarsProps {
  items: CategoryTotal[]
  limit?: number
  emptyText?: string
}

export function CategoryBars({
  items,
  limit,
  emptyText = '这个月还没有支出',
}: CategoryBarsProps) {
  const visible = limit ? items.slice(0, limit) : items
  const max = visible.reduce((value, item) => Math.max(value, item.value), 0)

  if (items.length === 0) {
    return <p className="category-empty">{emptyText}</p>
  }

  return (
    <ul className="category-bars">
      {visible.map((item) => {
        const width = max > 0 ? (item.value / max) * 100 : 0
        return (
          <li
            key={item.category.id}
            aria-label={`${item.category.name}，${formatMoney(item.value)}，占${formatPercent(item.share * 100)}`}
          >
            <div className="category-row-head">
              <span className="category-row-name">
                <CategoryIcon id={item.category.id} size={15} compact />
                {item.category.name}
              </span>
              <span className="category-row-value">
                {formatMoney(item.value)}
                <small>{formatPercent(item.share * 100)}</small>
              </span>
            </div>
            <div className="category-track" aria-hidden="true">
              <span style={{ width: `${width}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
