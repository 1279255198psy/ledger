import { ArrowLeftRight, Trash2 } from 'lucide-react'
import { formatMoney } from '../lib/utils'
import type { Account, SavingsTransfer } from '../types'

interface SavingsTransferRowProps {
  transfer: SavingsTransfer
  accounts: Account[]
  onDelete: (holdingId: string, entryId: string) => void
}

export function SavingsTransferRow({
  transfer,
  accounts,
  onDelete,
}: SavingsTransferRowProps) {
  const account = transfer.accountId
    ? accounts.find((item) => item.id === transfer.accountId)
    : undefined
  const label =
    transfer.direction === 'toSavings'
      ? `转账 · 存入「${transfer.holdingName}」`
      : `转账 · 从「${transfer.holdingName}」转回`

  return (
    <div className="transaction-row savings-transfer-row">
      <span className="savings-transfer-icon" aria-hidden="true">
        <ArrowLeftRight size={17} />
      </span>
      <div className="transaction-main">
        <div className="transaction-title">
          <span className="transaction-category">{label}</span>
          {transfer.note ? (
            <span className="transaction-note">{transfer.note}</span>
          ) : null}
        </div>
        <div className="transaction-meta">
          <span>{account?.name ?? '储蓄划转'}</span>
          <span className="meta-dot" aria-hidden>
            ·
          </span>
          <span>
            {transfer.direction === 'toSavings' ? '不计支出' : '不计收入'}
          </span>
        </div>
      </div>
      <div className="transaction-amount savings-transfer-amount">
        {transfer.direction === 'toSavings' ? '−' : '+'}
        {formatMoney(transfer.amountCents / 100)}
      </div>
      <div className="transaction-actions">
        <button
          type="button"
          className="row-action row-action--danger"
          onClick={() => onDelete(transfer.holdingId, transfer.id)}
          aria-label="删除这笔储蓄划转"
          title="删除（同时影响储蓄余额）"
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  )
}
