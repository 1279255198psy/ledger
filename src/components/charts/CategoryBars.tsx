import type { CSSProperties } from 'react'
import { CategoryIcon } from '../CategoryIcon'
import {
  categoryCustomColor,
  categoryToneKey,
} from '../../lib/categories'
import { formatMoney, formatPercent } from '../../lib/utils'
import type { Category, CategoryTotal } from '../../types'

interface CategoryBarsProps {
  items: CategoryTotal[]
  limit?: number
  emptyText?: string
  composition?: boolean
}

function toneClass(category: Category): string {
  return categoryCustomColor(category)
    ? ''
    : `tone-${categoryToneKey(category)}`
}

function toneStyle(category: Category): CSSProperties | undefined {
  const color = categoryCustomColor(category)
  return color ? ({ '--tone': color } as CSSProperties) : undefined
}

export function CategoryBars({
  items,
  limit,
  emptyText = '这个月还没有支出',
  composition = false,
}: CategoryBarsProps) {
  const visible = limit ? items.slice(0, limit) : items
  const max = visible.reduce((value, item) => Math.max(value, item.value), 0)

  if (items.length === 0) {
    return <p className="category-empty">{emptyText}</p>
  }

  return (
    <div className="category-visual">
      {composition && items.length > 1 ? (
        <div className="category-composition" aria-hidden="true">
          {items.map((item) => (
            <span
              key={item.category.id}
              className={toneClass(item.category)}
              style={{
                flexGrow: Math.max(item.value, 0.01),
                flexBasis: 0,
                ...toneStyle(item.category),
              }}
            />
          ))}
        </div>
      ) : null}
      <ul className="category-bars">
        {visible.map((item) => {
          const width = max > 0 ? (item.value / max) * 100 : 0
          return (
            <li
              key={item.category.id}
              className={toneClass(item.category)}
              style={toneStyle(item.category)}
              aria-label={`${item.category.name}，${formatMoney(item.value)}，占${formatPercent(item.share * 100)}`}
            >
              <div className="category-row-head">
                <span className="category-row-name">
                  <CategoryIcon category={item.category} size={15} compact />
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
    </div>
  )
}
