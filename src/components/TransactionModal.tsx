import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react'
import { Modal } from './Modal'
import { CategoryIcon } from './CategoryIcon'
import {
  ACCOUNTS,
  getCategoriesForType,
} from '../lib/data'
import { formatMoney, localDateKey } from '../lib/utils'
import type {
  LedgerTransaction,
  TransactionDraft,
  TransactionType,
} from '../types'

interface TransactionModalProps {
  open: boolean
  editing: LedgerTransaction | null
  defaultDate: string
  onClose: () => void
  onSave: (draft: TransactionDraft) => void
  onDelete: (id: string) => void
}

function sanitizeAmount(value: string): string {
  const normalized = value.replace(/,/g, '').replace(/，/g, '.')
  const stripped = normalized.replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = stripped.split('.')
  const decimals = rest.join('').slice(0, 2)
  if (stripped.includes('.')) return `${whole}.${decimals}`
  return whole
}

export function TransactionModal({
  open,
  editing,
  defaultDate,
  onClose,
  onSave,
  onDelete,
}: TransactionModalProps) {
  const [type, setType] = useState<TransactionType>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('food')
  const [accountId, setAccountId] = useState('wechat')
  const [date, setDate] = useState(defaultDate)
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const categories = useMemo(() => getCategoriesForType(type), [type])

  useEffect(() => {
    if (!open) return
    if (editing) {
      setType(editing.type)
      setAmount(String(editing.amount))
      setCategoryId(editing.categoryId)
      setAccountId(editing.accountId)
      setDate(editing.date)
      setNote(editing.note)
    } else {
      setType('expense')
      setAmount('')
      setCategoryId('food')
      setAccountId('wechat')
      setDate(defaultDate)
      setNote('')
    }
    setError('')
  }, [open, editing, defaultDate])

  const handleTypeChange = (nextType: TransactionType) => {
    setType(nextType)
    setError('')
    const nextCategories = getCategoriesForType(nextType)
    if (!nextCategories.some((category) => category.id === categoryId)) {
      setCategoryId(nextCategories[0].id)
    }
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const numericAmount = Number(amount)
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError('请输入大于 0 的金额')
      return
    }
    if (numericAmount > 99_999_999) {
      setError('金额太大了，请重新输入')
      return
    }
    if (!date) {
      setError('请选择日期')
      return
    }

    onSave({
      type,
      amount: Math.round(numericAmount * 100) / 100,
      categoryId,
      accountId,
      date,
      note: note.trim().slice(0, 80),
    })
  }

  const handleDelete = () => {
    if (!editing) return
    onDelete(editing.id)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="transaction-modal-title"
      className="transaction-modal"
    >
      <form onSubmit={handleSubmit}>
        <header className="modal-header">
          <div>
            <p className="eyebrow">{editing ? '编辑流水' : '新的一笔'}</p>
            <h2 id="transaction-modal-title">
              {editing ? '修改这笔记录' : '记下此刻的花销'}
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

        <div className="modal-body">
          <div className="type-switch" role="group" aria-label="类型">
            <button
              type="button"
              className={type === 'expense' ? 'is-active' : ''}
              onClick={() => handleTypeChange('expense')}
              aria-pressed={type === 'expense'}
            >
              <ArrowUpRight size={16} />
              支出
            </button>
            <button
              type="button"
              className={type === 'income' ? 'is-active' : ''}
              onClick={() => handleTypeChange('income')}
              aria-pressed={type === 'income'}
            >
              <ArrowDownLeft size={16} />
              收入
            </button>
          </div>

          <label className="amount-field">
            <span className="field-label">
              {type === 'expense' ? '这次花了多少' : '这次收入多少'}
            </span>
            <span className={`amount-input-wrap type-${type}`}>
              <span className="currency-mark">¥</span>
              <input
                data-autofocus
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(sanitizeAmount(event.target.value))
                  setError('')
                }}
                placeholder="0.00"
                aria-label="金额"
                autoComplete="off"
              />
            </span>
          </label>

          {amount && Number(amount) > 0 ? (
            <p className="amount-preview" aria-live="polite">
              {type === 'expense' ? '记录支出 ' : '记录收入 '}
              <strong>{formatMoney(Number(amount))}</strong>
            </p>
          ) : null}

          <fieldset className="form-section">
            <legend className="field-label">分类</legend>
            <div className="category-picker">
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  className={`category-option${categoryId === category.id ? ' is-selected' : ''}`}
                  onClick={() => setCategoryId(category.id)}
                  aria-pressed={categoryId === category.id}
                >
                  <CategoryIcon id={category.id} size={19} />
                  <span>{category.name}</span>
                  {categoryId === category.id ? (
                    <Check className="category-check" size={13} aria-hidden />
                  ) : null}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="form-row">
            <label className="field">
              <span className="field-label">
                <CalendarDays size={14} /> 日期
              </span>
              <input
                type="date"
                value={date}
                max={localDateKey()}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>

            <label className="field">
              <span className="field-label">
                <WalletCards size={14} /> 账户
              </span>
              <select
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                {ACCOUNTS.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span className="field-label">
              备注 <span className="optional">选填</span>
            </span>
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="给这笔记录留一句话"
              maxLength={80}
            />
          </label>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <footer className="modal-footer">
          {editing ? (
            <button type="button" className="text-button danger" onClick={handleDelete}>
              <Trash2 size={15} />
              删除
            </button>
          ) : (
            <span className="modal-footnote">数据只保存在你的设备上</span>
          )}
          <div className="modal-actions">
            <button type="button" className="button ghost" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="button primary">
              {editing ? '保存修改' : '记下这笔'}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  )
}
