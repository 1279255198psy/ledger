import { ArrowRight, CalendarClock, Check, Repeat2, X } from 'lucide-react'
import { CategoryIcon } from './CategoryIcon'
import { getCategoryPathName } from '../lib/categories'
import { formatRecurringDate } from '../lib/recurring'
import { formatMoney } from '../lib/utils'
import type { Category, RecurringPending } from '../types'

interface RecurringPendingCardProps {
  items: RecurringPending[]
  categories: Category[]
  /** Overview shows a short list; the transactions page shows everything. */
  compact?: boolean
  onConfirm: (item: RecurringPending) => void
  onSkip: (item: RecurringPending) => void
  onOpenAll?: () => void
}

const COMPACT_LIMIT = 5

/**
 * Pending periods wait for the user before touching balances or budgets, so
 * confirming one can still adjust the amount for a variable bill.
 */
export function RecurringPendingCard({
  items,
  categories,
  compact = false,
  onConfirm,
  onSkip,
  onOpenAll,
}: RecurringPendingCardProps) {
  if (items.length === 0) return null

  const sorted = [...items].sort(
    (left, right) =>
      right.date.localeCompare(left.date) ||
      left.id.localeCompare(right.id),
  )
  const shown = compact ? sorted.slice(0, COMPACT_LIMIT) : sorted
  const hidden = sorted.length - shown.length
  const totalCents = shown.reduce(
    (sum, item) =>
      item.template.type === 'expense'
        ? sum + item.template.amountCents
        : sum,
    0,
  )

  return (
    <section
      className={`card recurring-pending-card${
        compact ? ' is-compact' : ''
      }`}
      aria-label="周期记账待确认"
    >
      <header className="recurring-pending-head">
        <div>
          <p className="eyebrow">
            <Repeat2 size={12} aria-hidden /> 周期记账
          </p>
          <h2>待确认 · {items.length} 期</h2>
          {!compact ? (
            <p>
              这些账到期了，确认后才会记进流水；金额有变化可以直接改。
            </p>
          ) : null}
        </div>
        {totalCents > 0 && !compact ? (
          <span className="recurring-pending-total">
            支出约 {formatMoney(totalCents / 100)}
          </span>
        ) : null}
      </header>

      <div className="recurring-pending-list">
        {shown.map((item) => {
          const category = categories.find(
            (entry) =>
              entry.id === item.template.categoryId &&
              entry.type === item.template.type,
          )
          const title =
            item.template.note ||
            (category ? getCategoryPathName(category) : '周期记账')
          return (
            <article className="recurring-pending-item" key={item.id}>
              <span
                className={`recurring-pending-icon is-${item.template.type}`}
                aria-hidden
              >
                {category ? (
                  <CategoryIcon category={category} size={16} />
                ) : (
                  <CalendarClock size={16} />
                )}
              </span>

              <div className="recurring-pending-copy">
                <div className="recurring-pending-top">
                  <strong>{title}</strong>
                  <span
                    className={`recurring-pending-amount is-${item.template.type}`}
                  >
                    {item.template.type === 'income' ? '+' : '−'}
                    {formatMoney(item.template.amountCents / 100)}
                  </span>
                </div>
                <span className="recurring-pending-meta">
                  {formatRecurringDate(item.date)}
                  {category ? ` · ${getCategoryPathName(category)}` : ''}
                </span>
              </div>

              <div className="recurring-pending-actions">
                <button
                  type="button"
                  className="button primary recurring-pending-confirm"
                  onClick={() => onConfirm(item)}
                  aria-label={`确认 ${title} ${formatRecurringDate(
                    item.date,
                  )}`}
                >
                  <Check size={13} />
                  确认
                </button>
                <button
                  type="button"
                  className="button ghost recurring-pending-skip"
                  onClick={() => onSkip(item)}
                  aria-label={`跳过 ${title} ${formatRecurringDate(
                    item.date,
                  )}`}
                >
                  <X size={13} />
                  跳过
                </button>
              </div>
            </article>
          )
        })}
      </div>

      {hidden > 0 || (compact && onOpenAll) ? (
        <div className="recurring-pending-foot">
          <span>
            {hidden > 0
              ? `还有 ${hidden} 期没有显示`
              : '也可以到流水页逐期确认'}
          </span>
          {onOpenAll ? (
            <button
              type="button"
              className="button ghost"
              onClick={onOpenAll}
            >
              去流水页
              <ArrowRight size={14} />
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
