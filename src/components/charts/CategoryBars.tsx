import { useId, useState, type CSSProperties } from 'react'
import { ChevronRight } from 'lucide-react'
import { CategoryIcon } from '../CategoryIcon'
import {
  categoryCustomColor,
  categoryToneKey,
} from '../../lib/categories'
import {
  formatMoney,
  formatPercent,
  formatSignedMoney,
  getSubcategoryTotals,
} from '../../lib/utils'
import type {
  Category,
  CategoryTotal,
  LedgerTransaction,
  TransactionType,
} from '../../types'

interface CategoryBarsProps {
  items: CategoryTotal[]
  limit?: number
  emptyText?: string
  composition?: boolean
  /** Supplying the month's transactions turns on the subcategory breakdown. */
  transactions?: LedgerTransaction[]
  type?: TransactionType
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

function SubcategoryRows({
  id,
  entries,
  rootId,
}: {
  id: string
  entries: CategoryTotal[]
  rootId: string
}) {
  const max = entries.reduce((value, entry) => Math.max(value, entry.value), 0)

  return (
    <ul className="category-sublist" id={id}>
      {entries.map((entry) => {
        // The parent's own category means money booked without a
        // subcategory, not a real subcategory row.
        const direct = entry.category.id === rootId
        const width =
          max > 0 ? (Math.max(entry.value, 0) / max) * 100 : 0
        return (
          <li
            key={entry.category.id}
            className={`category-subrow${entry.value < 0 ? ' is-negative' : ''}`}
            aria-label={`${direct ? '未细分' : entry.category.name}，${formatSignedMoney(entry.value)}，占${formatPercent(entry.share * 100)}`}
          >
            <div className="category-subrow-head">
              <span className="category-subrow-name">
                <CategoryIcon category={entry.category} size={12} compact />
                {direct ? '未细分' : entry.category.name}
              </span>
              <span className="category-subrow-value">
                {formatSignedMoney(entry.value)}
                <small>{formatPercent(entry.share * 100)}</small>
              </span>
            </div>
            <div className="category-subtrack" aria-hidden="true">
              <span style={{ width: `${width}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function CategoryBars({
  items,
  limit,
  emptyText = '这个月还没有支出',
  composition = false,
  transactions,
  type = 'expense',
}: CategoryBarsProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    () => new Set(),
  )
  const detailIdPrefix = useId()
  const visible = limit ? items.slice(0, limit) : items
  const max = visible.reduce((value, item) => Math.max(value, item.value), 0)
  const breakdowns = transactions
    ? new Map(
        visible.map((item) => [
          item.category.id,
          getSubcategoryTotals(transactions, item.category.id, type),
        ]),
      )
    : null
  const hasBreakdown = breakdowns
    ? visible.some((item) =>
        (breakdowns.get(item.category.id) ?? []).some(
          (entry) => entry.category.id !== item.category.id,
        ),
      )
    : false

  function toggleExpanded(rootId: string) {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(rootId)) next.delete(rootId)
      else next.add(rootId)
      return next
    })
  }

  if (items.length === 0) {
    return <p className="category-empty">{emptyText}</p>
  }

  return (
    <div
      className={`category-visual${hasBreakdown ? ' category-visual--expandable' : ''}`}
    >
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
          const breakdown = breakdowns?.get(item.category.id) ?? []
          const hasSubcategories = breakdown.some(
            (entry) => entry.category.id !== item.category.id,
          )
          const expanded = hasSubcategories && expandedIds.has(item.category.id)
          const detailId = `${detailIdPrefix}-${item.category.id}`
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
                {hasSubcategories ? (
                  <button
                    type="button"
                    className="category-row-toggle"
                    onClick={() => toggleExpanded(item.category.id)}
                    aria-expanded={expanded}
                    aria-controls={detailId}
                    aria-label={`${expanded ? '收起' : '展开'}${item.category.name}的小分类`}
                    title={expanded ? '收起小分类' : '展开小分类'}
                  >
                    <ChevronRight
                      size={14}
                      className={expanded ? 'is-expanded' : undefined}
                    />
                  </button>
                ) : null}
              </div>
              <div className="category-track" aria-hidden="true">
                <span style={{ width: `${width}%` }} />
              </div>
              {expanded ? (
                <SubcategoryRows
                  id={detailId}
                  entries={breakdown}
                  rootId={item.category.id}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
