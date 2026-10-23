import { Pencil, Trash2 } from 'lucide-react'
import { CategoryIcon } from './CategoryIcon'
import { getAccount, getCategory } from '../lib/data'
import { getParentCategory } from '../lib/categories'
import {
  getProjectAmountCents,
  getProjectIds,
  getScope,
} from '../lib/allocations'
import { formatMoney, formatShortDate } from '../lib/utils'
import type { LedgerTransaction, Project } from '../types'

interface TransactionRowProps {
  transaction: LedgerTransaction
  projects?: Project[]
  projectId?: string
  onEdit: (transaction: LedgerTransaction) => void
  onDelete: (id: string) => void
  showDate?: boolean
  compact?: boolean
}

export function TransactionRow({
  transaction,
  projects = [],
  projectId,
  onEdit,
  onDelete,
  showDate = false,
  compact = false,
}: TransactionRowProps) {
  const category = getCategory(transaction.categoryId, transaction.type)
  const parentCategory = getParentCategory(category)
  const categoryLabel = parentCategory
    ? `${parentCategory.name} · ${category.name}`
    : category.name
  const account = getAccount(transaction.accountId)
  const isIncome = transaction.type === 'income'
  const amountCents =
    projectId !== undefined
      ? getProjectAmountCents(transaction, projectId)
      : transaction.amountCents
  const amount = formatMoney(amountCents / 100)
  const projectIds = getProjectIds(transaction)
  const projectNames = projectIds
    .map((id) => projects.find((project) => project.id === id)?.name)
    .filter((name): name is string => Boolean(name))
  const projectLabel =
    projectNames.length > 0 ? projectNames.join(' / ') : '未命名项目'
  const scope = getScope(transaction)

  return (
    <div className={`transaction-row${compact ? ' is-compact' : ''}`}>
      <CategoryIcon
        category={category}
        size={compact ? 17 : 19}
      />

      <div className="transaction-main">
        <div className="transaction-title">
          <span className="transaction-category">
            {parentCategory ? (
              <>
                <span className="transaction-category-parent">
                  {parentCategory.name}
                </span>
                <span className="transaction-category-sep" aria-hidden>
                  ·
                </span>
                <span>{category.name}</span>
              </>
            ) : (
              category.name
            )}
          </span>
          {transaction.note ? (
            <span className="transaction-note">{transaction.note}</span>
          ) : null}
        </div>
        <div className="transaction-meta">
          <span>{account.name}</span>
          <span className="meta-dot" aria-hidden>
            ·
          </span>
          <span>
            {showDate ? formatShortDate(transaction.date) : category.type === 'expense' ? '支出' : '收入'}
          </span>
          {!isIncome && transaction.spendingNature ? (
            <>
              <span className="meta-dot" aria-hidden>
                ·
              </span>
              <span
                className={`transaction-nature is-${transaction.spendingNature}`}
              >
                {transaction.spendingNature === 'essential' ? '刚需' : '弹性'}
              </span>
            </>
          ) : null}
          {projectIds.length > 0 ? (
            <>
              <span className="meta-dot" aria-hidden>
                ·
              </span>
              <span className="transaction-project" title={projectLabel}>
                {scope === 'shared' ? '共用' : '项目'} · {projectLabel}
              </span>
            </>
          ) : null}
        </div>
      </div>

      <span
        className={`transaction-amount${isIncome ? ' is-income' : ''}`}
        aria-label={`${isIncome ? '收入' : '支出'} ${amount}`}
      >
        {isIncome ? '+' : '−'}
        {amount}
      </span>

      <div className="transaction-actions">
        <button
          type="button"
          className="row-action"
          onClick={() => onEdit(transaction)}
          aria-label={`编辑${categoryLabel}记录`}
          title="编辑"
        >
          <Pencil size={15} />
        </button>
        <button
          type="button"
          className="row-action row-action--danger"
          onClick={() => onDelete(transaction.id)}
          aria-label={`删除${categoryLabel}记录`}
          title="删除"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}
