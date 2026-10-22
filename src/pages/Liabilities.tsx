import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {
  getLiabilitySummary,
  getLiabilityTotals,
  sortedRepayments,
} from '../lib/liabilities'
import {
  formatMoney,
  formatShortDate,
  localDateKey,
} from '../lib/utils'
import type {
  Liability,
  LiabilityDraft,
  RepaymentDraft,
} from '../types'

interface LiabilitiesProps {
  liabilities: Liability[]
  onCreate: (draft: LiabilityDraft) => void
  onUpdate: (id: string, draft: LiabilityDraft) => void
  onDelete: (id: string) => void
  onAddRepayment: (liabilityId: string, draft: RepaymentDraft) => void
  onDeleteRepayment: (liabilityId: string, repaymentId: string) => void
}

interface EditorState {
  mode: 'create' | 'edit'
  id?: string
}

function sanitizeMoney(value: string): string {
  const normalized = value.replace(/,/g, '').replace(/，/g, '.')
  const stripped = normalized.replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = stripped.split('.')
  const decimals = rest.join('').slice(0, 2)
  if (stripped.includes('.')) return `${whole}.${decimals}`
  return whole
}

function centsToInput(cents: number): string {
  return (cents / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1')
}

export function Liabilities({
  liabilities,
  onCreate,
  onUpdate,
  onDelete,
  onAddRepayment,
  onDeleteRepayment,
}: LiabilitiesProps) {
  const totals = getLiabilityTotals(liabilities)
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [name, setName] = useState('')
  const [principal, setPrincipal] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [repayAmount, setRepayAmount] = useState('')
  const [repayDate, setRepayDate] = useState(localDateKey())
  const [repayNote, setRepayNote] = useState('')
  const [repayError, setRepayError] = useState('')

  const openCreate = () => {
    setEditor({ mode: 'create' })
    setName('')
    setPrincipal('')
    setDueDate('')
    setNote('')
    setFormError('')
  }

  const openEdit = (liability: Liability) => {
    setEditor({ mode: 'edit', id: liability.id })
    setName(liability.name)
    setPrincipal(centsToInput(liability.principalCents))
    setDueDate(liability.dueDate ?? '')
    setNote(liability.note ?? '')
    setFormError('')
  }

  const closeEditor = () => {
    setEditor(null)
    setFormError('')
  }

  const handleDelete = (id: string) => {
    if (editor?.id === id) closeEditor()
    if (expandedId === id) setExpandedId(null)
    onDelete(id)
  }

  const toggleExpanded = (id: string) => {
    setExpandedId((current) => (current === id ? null : id))
    setRepayAmount('')
    setRepayDate(localDateKey())
    setRepayNote('')
    setRepayError('')
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!editor) return
    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('给这笔负债起一个名字')
      return
    }
    if (trimmed.length > 40) {
      setFormError('名称最多 40 个字')
      return
    }
    const amountCents = Math.round(Number(principal) * 100)
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setFormError('请输入大于 0 的本金')
      return
    }
    if (editor.mode === 'edit' && editor.id) {
      const liability = liabilities.find((item) => item.id === editor.id)
      if (
        liability &&
        amountCents < getLiabilitySummary(liability).repaidCents
      ) {
        setFormError('本金不能低于已经还掉的金额')
        return
      }
    }
    const draft: LiabilityDraft = {
      name: trimmed,
      principalCents: amountCents,
      ...(dueDate ? { dueDate } : {}),
      ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}),
    }
    if (editor.mode === 'edit' && editor.id) {
      onUpdate(editor.id, draft)
    } else {
      onCreate(draft)
    }
    closeEditor()
  }

  const handleRepay = (event: FormEvent, liability: Liability) => {
    event.preventDefault()
    const summary = getLiabilitySummary(liability)
    const amountCents = Math.round(Number(repayAmount) * 100)
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setRepayError('请输入大于 0 的还款金额')
      return
    }
    if (amountCents > summary.remainingCents) {
      setRepayError(
        `还款金额不能超过剩余欠款 ${formatMoney(summary.remainingCents / 100)}`,
      )
      return
    }
    if (!repayDate) {
      setRepayError('请选择还款日期')
      return
    }
    onAddRepayment(liability.id, {
      amountCents,
      date: repayDate,
      ...(repayNote.trim() ? { note: repayNote.trim().slice(0, 200) } : {}),
    })
    setRepayAmount('')
    setRepayDate(localDateKey())
    setRepayNote('')
    setRepayError('')
  }

  return (
    <div className="page-stack liabilities-page">
      <section className="card liability-summary" aria-label="负债概览">
        <div className="summary-cell">
          <span>负债总额</span>
          <strong>{formatMoney(totals.principalCents / 100)}</strong>
        </div>
        <div className="summary-cell">
          <span>已还金额</span>
          <strong className="is-income">
            {formatMoney(totals.repaidCents / 100)}
          </strong>
        </div>
        <div className="summary-cell">
          <span>剩余未还</span>
          <strong className={totals.remainingCents > 0 ? 'is-negative' : ''}>
            {formatMoney(totals.remainingCents / 100)}
          </strong>
        </div>
        <div className="summary-cell summary-cell--count">
          <span>未结清</span>
          <strong>{totals.activeCount} 笔</strong>
        </div>
      </section>

      <section className="card liability-panel">
        <div className="liability-panel-head">
          <div>
            <p className="card-kicker">借与还</p>
            <h2>负债清单</h2>
            <p className="card-sub">
              记录借款本金和每一次还款，剩余金额会自动算好。
            </p>
          </div>
          <button type="button" className="button primary" onClick={openCreate}>
            <Plus size={16} />
            新增负债
          </button>
        </div>

        {editor ? (
          <form className="liability-editor" onSubmit={handleSubmit}>
            <div className="liability-editor-head">
              <strong>
                {editor.mode === 'edit' ? '编辑负债' : '新增负债'}
              </strong>
              <button
                type="button"
                className="icon-button"
                onClick={closeEditor}
                aria-label="关闭负债编辑"
              >
                <X size={17} />
              </button>
            </div>
            <div className="liability-form-row">
              <label className="field">
                <span className="field-label">名称</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    setFormError('')
                  }}
                  placeholder="例如：房贷、朋友借款"
                  maxLength={40}
                />
              </label>
              <label className="field">
                <span className="field-label">本金</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={principal}
                  onChange={(event) => {
                    setPrincipal(sanitizeMoney(event.target.value))
                    setFormError('')
                  }}
                  placeholder="0.00"
                />
              </label>
              <label className="field">
                <span className="field-label">
                  到期日 <span className="optional">选填</span>
                </span>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(event) => setDueDate(event.target.value)}
                />
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
                placeholder="利率、还款方式，或一句提醒"
                maxLength={200}
              />
            </label>
            {formError ? (
              <p className="form-error" role="alert">
                {formError}
              </p>
            ) : null}
            <div className="liability-editor-actions">
              <button
                type="button"
                className="button ghost"
                onClick={closeEditor}
              >
                取消
              </button>
              <button type="submit" className="button primary">
                {editor.mode === 'edit' ? '保存修改' : '记下这笔负债'}
              </button>
            </div>
          </form>
        ) : null}

        {liabilities.length === 0 && !editor ? (
          <div className="liability-empty">
            <div className="empty-mark" aria-hidden="true">
              <CheckCircle2 size={22} />
            </div>
            <h2>没有负债要记</h2>
            <p>如果有借款、房贷或分期，可以在这里记下本金和每次还款。</p>
            <button type="button" className="button primary" onClick={openCreate}>
              <Plus size={16} />
              新增第一笔负债
            </button>
          </div>
        ) : (
          <div className="liability-list">
            {liabilities.map((liability) => {
              const summary = getLiabilitySummary(liability)
              const expanded = expandedId === liability.id
              const progress =
                liability.principalCents > 0
                  ? Math.min(
                      (summary.repaidCents / liability.principalCents) * 100,
                      100,
                    )
                  : 0
              const repayments = sortedRepayments(liability)
              return (
                <article
                  className={`liability-item${
                    summary.settled ? ' is-settled' : ''
                  }${summary.overdue ? ' is-overdue' : ''}`}
                  key={liability.id}
                >
                  <div className="liability-item-head">
                    <div className="liability-title">
                      <strong>{liability.name}</strong>
                      <span
                        className={`liability-status${
                          summary.settled
                            ? ' is-settled'
                            : summary.overdue
                              ? ' is-overdue'
                              : ' is-active'
                        }`}
                      >
                        {summary.settled
                          ? '已结清'
                          : summary.overdue
                            ? '已逾期'
                            : '还款中'}
                      </span>
                    </div>
                    <div className="liability-item-actions">
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => openEdit(liability)}
                        aria-label={`编辑${liability.name}`}
                        title="编辑"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="row-action row-action--danger"
                        onClick={() => handleDelete(liability.id)}
                        aria-label={`删除${liability.name}`}
                        title="删除"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="liability-metrics">
                    <div>
                      <span>本金</span>
                      <strong>{formatMoney(liability.principalCents / 100)}</strong>
                    </div>
                    <div>
                      <span>已还</span>
                      <strong className="is-income">
                        {formatMoney(summary.repaidCents / 100)}
                      </strong>
                    </div>
                    <div>
                      <span>剩余</span>
                      <strong className={summary.remainingCents > 0 ? 'is-negative' : ''}>
                        {formatMoney(summary.remainingCents / 100)}
                      </strong>
                    </div>
                  </div>

                  <div className="liability-meter" aria-hidden="true">
                    <span style={{ width: `${progress}%` }} />
                  </div>

                  <div className="liability-meta">
                    <span>
                      {liability.dueDate
                        ? `到期 ${formatShortDate(liability.dueDate)}`
                        : '没有设定到期日'}
                    </span>
                    <span>{repayments.length} 次还款</span>
                    {liability.note ? (
                      <span className="liability-note">{liability.note}</span>
                    ) : null}
                  </div>

                  {!summary.settled ? (
                    expanded ? (
                      <form
                        className="repayment-form"
                        onSubmit={(event) => handleRepay(event, liability)}
                      >
                        <input
                          type="text"
                          inputMode="decimal"
                          value={repayAmount}
                          onChange={(event) => {
                            setRepayAmount(sanitizeMoney(event.target.value))
                            setRepayError('')
                          }}
                          placeholder="还款金额"
                          aria-label="还款金额"
                        />
                        <input
                          type="date"
                          value={repayDate}
                          max={localDateKey()}
                          onChange={(event) => {
                            setRepayDate(event.target.value)
                            setRepayError('')
                          }}
                          aria-label="还款日期"
                        />
                        <input
                          type="text"
                          value={repayNote}
                          onChange={(event) => setRepayNote(event.target.value)}
                          placeholder="备注（选填）"
                          maxLength={200}
                          aria-label="还款备注"
                        />
                        <button type="submit" className="button secondary">
                          记下还款
                        </button>
                      </form>
                    ) : (
                      <button
                        type="button"
                        className="liability-repay-trigger"
                        onClick={() => toggleExpanded(liability.id)}
                      >
                        <Plus size={14} />
                        记一笔还款
                      </button>
                    )
                  ) : null}

                  {repayError && expanded ? (
                    <p className="form-error" role="alert">
                      {repayError}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    className="liability-history-toggle"
                    onClick={() => toggleExpanded(liability.id)}
                    aria-expanded={expanded}
                  >
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                    还款记录
                    <span>{repayments.length}</span>
                  </button>

                  {expanded ? (
                    repayments.length > 0 ? (
                      <ul className="repayment-list">
                        {repayments.map((repayment) => (
                          <li key={repayment.id}>
                            <span className="repayment-date">
                              {formatShortDate(repayment.date)}
                            </span>
                            <span className="repayment-note">
                              {repayment.note || '还款'}
                            </span>
                            <strong>
                              {formatMoney(repayment.amountCents / 100)}
                            </strong>
                            <button
                              type="button"
                              className="row-action row-action--danger"
                              onClick={() =>
                                onDeleteRepayment(liability.id, repayment.id)
                              }
                              aria-label="删除这笔还款"
                              title="删除还款"
                            >
                              <Trash2 size={14} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="repayment-empty">还没有还款记录。</p>
                    )
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}
