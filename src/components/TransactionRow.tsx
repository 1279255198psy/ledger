import { Pencil, Trash2 } from 'lucide-react'
import { CategoryIcon } from './CategoryIcon'
import { getAccount, getCategory } from '../lib/data'
import { formatMoney, formatShortDate } from '../lib/utils'
import type { LedgerTransaction } from '../types'

interface TransactionRowProps {
  transaction: LedgerTransaction
  onEdit: (transaction: LedgerTransaction) => void
  onDelete: (id: string) => void
  showDate?: boolean
  compact?: boolean
}

export function TransactionRow({
  transaction,
  onEdit,
  onDelete,
  showDate = false,
  compact = false,
}: TransactionRowProps) {
  const category = getCategory(transaction.categoryId)
  const account = getAccount(transaction.accountId)
  const isIncome = transaction.type === 'income'
  const amount = formatMoney(transaction.amount)

  return (
    <div className={`transaction-row${compact ? ' is-compact' : ''}`}>
      <CategoryIcon id={transaction.categoryId} size={compact ? 17 : 19} />

      <div className="transaction-main">
        <div className="transaction-title">
          <span>{category.name}</span>
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
          aria-label={`编辑${category.name}记录`}
          title="编辑"
        >
          <Pencil size={15} />
        </button>
        <button
          type="button"
          className="row-action row-action--danger"
          onClick={() => onDelete(transaction.id)}
          aria-label={`删除${category.name}记录`}
          title="删除"
        >
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  )
}
