import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import { Modal } from './Modal'
import { activeCurrencySymbol } from '../lib/currency'
import { parseCents } from '../lib/budgetForm'
import { formatMoney, monthLabel } from '../lib/utils'
import type { MonthBudgetMetrics } from '../types'

const QUICK_REASONS = [
  '这个月花得比计划少',
  '有额外的必要支出',
  '临时压缩开支',
  '调整生活节奏',
]

interface BudgetAdjustDialogProps {
  open: boolean
  monthKey: string
  metrics: MonthBudgetMetrics
  onClose: () => void
  onConfirm: (
    amountCents: number,
    note: string,
    rescheduleDaily: boolean,
  ) => void
}

/**
 * Live budget change for the current month. The original plan stays where it
 * is; this dialog only moves the amount in force and records why.
 */
export function BudgetAdjustDialog({
  open,
  monthKey,
  metrics,
  onClose,
  onConfirm,
}: BudgetAdjustDialogProps) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [rescheduleDaily, setRescheduleDaily] = useState(true)
  const [error, setError] = useState('')

  const symbol = activeCurrencySymbol()
  const canReschedule = metrics.daily?.mode === 'manual' && metrics.daily.isLive

  useEffect(() => {
    if (!open) return
    setAmount((metrics.amountCents / 100).toFixed(2))
    setNote('')
    setRescheduleDaily(true)
    setError('')
  }, [open, metrics.amountCents, metrics.monthKey])

  const nextCents = useMemo(() => parseCents(amount), [amount])
  const deltaCents =
    nextCents === null ? null : nextCents - metrics.amountCents
  const belowSpent =
    nextCents !== null && nextCents > 0 && nextCents < metrics.spentCents

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (nextCents === null || nextCents <= 0) {
      setError('请输入大于 0 的预算金额')
      return
    }
    if (!note.trim()) {
      setError('请填写调整原因，方便以后回看这次调整')
      return
    }
    setError('')
    onConfirm(nextCents, note.trim(), canReschedule && rescheduleDaily)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="budget-adjust-title"
      className="budget-adjust-modal"
    >
      <header className="modal-header">
        <div>
          <p className="eyebrow">动态预算</p>
          <h2 id="budget-adjust-title">
            调整 {monthLabel(monthKey)} 预算
          </h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="关闭"
        >
          <X size={19} />
        </button>
      </header>

      <form className="modal-body budget-adjust-body" onSubmit={handleSubmit}>
        <div className="budget-adjust-summary">
          <div>
            <span>原定预算</span>
            <strong>{formatMoney(metrics.baseAmountCents / 100)}</strong>
          </div>
          <div>
            <span>当前预算</span>
            <strong>{formatMoney(metrics.amountCents / 100)}</strong>
          </div>
          <div>
            <span>本月已用</span>
            <strong
              className={
                metrics.spentCents > metrics.amountCents ? 'is-negative' : ''
              }
            >
              {formatMoney(metrics.spentCents / 100)}
            </strong>
          </div>
        </div>

        <label className="budget-input budget-input--wide">
          <span>{symbol}</span>
          <input
            type="number"
            inputMode="decimal"
            min="0.01"
            step="0.01"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value)
              setError('')
            }}
            placeholder="0.00"
            aria-label="调整后的预算金额"
            data-autofocus
          />
        </label>

        <p className="budget-adjust-delta">
          {deltaCents === null || deltaCents === 0 ? (
            <span>金额没有变化</span>
          ) : (
            <span className={deltaCents > 0 ? 'is-up' : 'is-down'}>
              本次{deltaCents > 0 ? '上调' : '下调'}{' '}
              <strong>{formatMoney(Math.abs(deltaCents) / 100)}</strong>
              <small>
                原定预算保持 {formatMoney(metrics.baseAmountCents / 100)} 不变
              </small>
            </span>
          )}
        </p>

        {belowSpent ? (
          <p className="budget-adjust-warning" role="status">
            <AlertTriangle size={15} />
            新预算低于本月已用 {formatMoney(metrics.spentCents / 100)}
            ，保存后会立即显示超支。
          </p>
        ) : null}

        <div className="budget-adjust-reasons">
          <div className="budget-adjust-reason-head">
            <span>调整原因</span>
            <em>必填</em>
          </div>
          <div className="budget-adjust-chips">
            {QUICK_REASONS.map((reason) => (
              <button
                key={reason}
                type="button"
                className={note === reason ? 'is-active' : ''}
                onClick={() => {
                  setNote(reason)
                  setError('')
                }}
              >
                {reason}
              </button>
            ))}
          </div>
          <textarea
            rows={3}
            value={note}
            onChange={(event) => {
              setNote(event.target.value)
              setError('')
            }}
            placeholder="写下这次调整的原因，统计时能对上当时的情况"
            aria-label="调整原因"
          />
        </div>

        {canReschedule ? (
          <label className="budget-adjust-check">
            <input
              type="checkbox"
              checked={rescheduleDaily}
              onChange={(event) => setRescheduleDaily(event.target.checked)}
            />
            <span>
              <strong>按剩余天数重排每日额度</strong>
              <small>
                保留今天之前的额度，把剩余预算重新分给今天及之后的日子
              </small>
            </span>
          </label>
        ) : null}

        <p className="budget-adjust-footnote">
          每次调整都会记录时间、调整前后金额和原因；原定预算不会被改动。
        </p>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="budget-form-actions">
          <button type="submit" className="button secondary">
            保存调整
          </button>
          <button type="button" className="button ghost" onClick={onClose}>
            取消
          </button>
        </div>
      </form>
    </Modal>
  )
}
