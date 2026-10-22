import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowDownLeft,
  ArrowUpRight,
  CalendarDays,
  Check,
  Plus,
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
import {
  getProjectIds,
  getScope,
  largestRemainder,
  makeDailyAllocation,
  makeProjectAllocation,
  newAllocationId,
} from '../lib/allocations'
import { activeCurrencySymbol } from '../lib/currency'
import { formatMoney, localDateKey } from '../lib/utils'
import type {
  AllocationLine,
  AllocationTarget,
  LedgerTransaction,
  Project,
  TransactionDraft,
  TransactionScope,
  TransactionType,
} from '../types'

interface TransactionModalProps {
  open: boolean
  editing: LedgerTransaction | null
  projects: Project[]
  defaultDate: string
  onClose: () => void
  onSave: (draft: TransactionDraft) => void
  onDelete: (id: string) => void
}

type SplitMode = 'ratio' | 'amount'

interface SplitRow {
  id: string
  target: string
  value: string
}

interface SplitResult {
  allocations: AllocationLine[]
  error: string
}

function sanitizeAmount(value: string): string {
  const normalized = value.replace(/,/g, '').replace(/，/g, '.')
  const stripped = normalized.replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = stripped.split('.')
  const decimals = rest.join('').slice(0, 2)
  if (stripped.includes('.')) return `${whole}.${decimals}`
  return whole
}

function parseDecimal(value: string): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function centsToInput(cents: number): string {
  return (cents / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1')
}

function targetKey(line: AllocationLine): string {
  return line.targetType === 'project' && line.projectId
    ? `project:${line.projectId}`
    : 'daily'
}

function createDefaultSplitRows(
  projects: Project[],
  mode: SplitMode,
  totalCents: number,
): SplitRow[] {
  const project =
    projects.find((item) => item.status === 'active') ?? projects[0]
  if (!project) {
    return [{ id: newAllocationId(), target: 'daily', value: '100' }]
  }

  if (mode === 'ratio') {
    return [
      { id: newAllocationId(), target: 'daily', value: '50' },
      {
        id: newAllocationId(),
        target: `project:${project.id}`,
        value: '50',
      },
    ]
  }

  const dailyCents =
    totalCents > 0 ? Math.floor(totalCents / 2) : 0
  return [
    {
      id: newAllocationId(),
      target: 'daily',
      value: totalCents > 0 ? centsToInput(dailyCents) : '',
    },
    {
      id: newAllocationId(),
      target: `project:${project.id}`,
      value: totalCents > 0 ? centsToInput(totalCents - dailyCents) : '',
    },
  ]
}

function buildSplitAllocations(
  rows: SplitRow[],
  mode: SplitMode,
  totalCents: number,
  projects: Project[],
): SplitResult {
  if (!Number.isFinite(totalCents) || totalCents <= 0) {
    return { allocations: [], error: '请先填写总额' }
  }

  const usable = rows.filter((row) => parseDecimal(row.value) > 0)
  if (usable.length === 0) {
    return { allocations: [], error: '请至少填写一条分摊' }
  }
  if (new Set(usable.map((row) => row.target)).size < 2) {
    return { allocations: [], error: '共用支出至少需要两个不同的归属' }
  }

  const projectIds = new Set(projects.map((project) => project.id))
  for (const row of usable) {
    if (
      row.target !== 'daily' &&
      !projectIds.has(row.target.slice('project:'.length))
    ) {
      return { allocations: [], error: '有一个项目已不可用，请重新选择' }
    }
  }

  const weights = usable.map((row) =>
    mode === 'ratio' ? Math.round(parseDecimal(row.value) * 100) : 0,
  )
  const amounts =
    mode === 'ratio'
      ? largestRemainder(totalCents, weights)
      : usable.map((row) => Math.round(parseDecimal(row.value) * 100))

  if (mode === 'amount') {
    const sum = amounts.reduce((total, value) => total + value, 0)
    if (sum !== totalCents) {
      return {
        allocations: [],
        error: `分摊合计 ${formatMoney(sum / 100)}，与总额相差 ${formatMoney(
          Math.abs(totalCents - sum) / 100,
        )}`,
      }
    }
  }

  interface MergedTarget {
    targetType: AllocationTarget
    projectId?: string
    amountCents: number
    weight: number
  }

  const merged = new Map<string, MergedTarget>()
  usable.forEach((row, index) => {
    const amountCents = amounts[index] ?? 0
    if (amountCents <= 0) return

    const current = merged.get(row.target)
    if (current) {
      current.amountCents += amountCents
      current.weight += weights[index]
      return
    }

    if (row.target === 'daily') {
      merged.set('daily', {
        targetType: 'daily',
        amountCents,
        weight: weights[index],
      })
      return
    }

    merged.set(row.target, {
      targetType: 'project',
      projectId: row.target.slice('project:'.length),
      amountCents,
      weight: weights[index],
    })
  })

  const allocations: AllocationLine[] = [...merged.values()].map((item) => ({
    id: newAllocationId(),
    targetType: item.targetType,
    ...(item.projectId ? { projectId: item.projectId } : {}),
    amountCents: item.amountCents,
    ...(mode === 'ratio' && item.weight > 0 ? { weight: item.weight } : {}),
    ratioBp: Math.round((item.amountCents / totalCents) * 10000),
    basis: mode === 'ratio' ? 'ratio' : 'fixed',
  }))

  if (allocations.length < 2) {
    return {
      allocations: [],
      error: '分摊金额太小，请调高金额或比例',
    }
  }

  const total = allocations.reduce(
    (sum, line) => sum + line.amountCents,
    0,
  )
  if (total !== totalCents) {
    return { allocations: [], error: '分摊没有对齐总额，请检查金额' }
  }

  return { allocations, error: '' }
}

export function TransactionModal({
  open,
  editing,
  projects,
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
  const [scope, setScope] = useState<TransactionScope>('daily')
  const [projectId, setProjectId] = useState('')
  const [splitMode, setSplitMode] = useState<SplitMode>('ratio')
  const [splitRows, setSplitRows] = useState<SplitRow[]>([])
  const [error, setError] = useState('')

  const categories = useMemo(() => getCategoriesForType(type), [type])

  const editingProjectIds = useMemo(
    () => new Set(editing ? getProjectIds(editing) : []),
    [editing],
  )

  const selectableProjects = useMemo(
    () =>
      projects
        .filter(
          (project) =>
            !project.archivedAt || editingProjectIds.has(project.id),
        )
        .sort((left, right) => {
          if (left.status !== right.status) {
            return left.status === 'active' ? -1 : 1
          }
          return left.name.localeCompare(right.name)
        }),
    [projects, editingProjectIds],
  )

  const totalCents = Math.round(parseDecimal(amount) * 100)
  const splitPreview = useMemo(
    () =>
      buildSplitAllocations(
        splitRows,
        splitMode,
        totalCents,
        selectableProjects,
      ),
    [splitRows, splitMode, totalCents, selectableProjects],
  )

  useEffect(() => {
    if (!open) return
    if (editing) {
      setType(editing.type)
      setAmount(String(editing.amountCents / 100))
      setCategoryId(editing.categoryId)
      setAccountId(editing.accountId)
      setDate(editing.date)
      setNote(editing.note)
      setScope(getScope(editing))
      setProjectId(getProjectIds(editing)[0] ?? '')
      setSplitMode('amount')
      setSplitRows(
        editing.allocations.map((line) => ({
          id: line.id,
          target: targetKey(line),
          value: centsToInput(line.amountCents),
        })),
      )
    } else {
      setType('expense')
      setAmount('')
      setCategoryId('food')
      setAccountId('wechat')
      setDate(defaultDate)
      setNote('')
      setScope('daily')
      setProjectId(selectableProjects[0]?.id ?? '')
      setSplitMode('ratio')
      setSplitRows([])
    }
    setError('')
  }, [open, editing, defaultDate, selectableProjects])

  const handleTypeChange = (nextType: TransactionType) => {
    setType(nextType)
    setError('')
    const nextCategories = getCategoriesForType(nextType)
    if (!nextCategories.some((category) => category.id === categoryId)) {
      setCategoryId(nextCategories[0].id)
    }
  }

  const handleScopeChange = (nextScope: TransactionScope) => {
    if (nextScope === scope) return
    setScope(nextScope)
    setError('')
    if (nextScope === 'project' && !projectId) {
      setProjectId(selectableProjects[0]?.id ?? '')
    }
    if (nextScope === 'shared') {
      setSplitMode('ratio')
      setSplitRows(createDefaultSplitRows(selectableProjects, 'ratio', totalCents))
    }
  }

  const handleSplitModeChange = (nextMode: SplitMode) => {
    if (nextMode === splitMode) return

    if (nextMode === 'amount') {
      if (totalCents <= 0) {
        setSplitRows((current) =>
          current.map((row) => ({ ...row, value: '' })),
        )
      } else {
        const weights = splitRows.map((row) => parseDecimal(row.value))
        const amounts = largestRemainder(totalCents, weights)
        setSplitRows((current) =>
          current.map((row, index) => ({
            ...row,
            value: centsToInput(amounts[index] ?? 0),
          })),
        )
      }
    } else {
      const amounts = splitRows.map((row) =>
        Math.round(parseDecimal(row.value) * 100),
      )
      const sum = amounts.reduce((total, value) => total + value, 0)
      setSplitRows((current) =>
        current.map((row, index) => ({
          ...row,
          value:
            sum > 0
              ? String(Math.round((amounts[index] / sum) * 10000) / 100)
              : '0',
        })),
      )
    }

    setSplitMode(nextMode)
    setError('')
  }

  const handleSplitTargetChange = (id: string, target: string) => {
    setSplitRows((current) =>
      current.map((row) => (row.id === id ? { ...row, target } : row)),
    )
    setError('')
  }

  const handleSplitValueChange = (id: string, value: string) => {
    const nextValue = sanitizeAmount(value)
    setSplitRows((current) =>
      current.map((row) =>
        row.id === id ? { ...row, value: nextValue } : row,
      ),
    )
    setError('')
  }

  const handleRemoveSplitRow = (id: string) => {
    setSplitRows((current) =>
      current.length <= 2
        ? current
        : current.filter((row) => row.id !== id),
    )
    setError('')
  }

  const availableTargets = [
    'daily',
    ...selectableProjects.map((project) => `project:${project.id}`),
  ].filter(
    (target) => !splitRows.some((row) => row.target === target),
  )

  const handleAddSplitRow = () => {
    const target = availableTargets[0]
    if (!target) return
    setSplitRows((current) => [
      ...current,
      { id: newAllocationId(), target, value: '0' },
    ])
    setError('')
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

    const amountCents = Math.round(numericAmount * 100)
    let allocations: AllocationLine[]

    if (scope === 'daily') {
      allocations = [makeDailyAllocation(amountCents)]
    } else if (scope === 'project') {
      const project = selectableProjects.find(
        (item) => item.id === projectId,
      )
      if (!project) {
        setError('请选择一个项目')
        return
      }
      allocations = [makeProjectAllocation(project.id, amountCents)]
    } else {
      const built = buildSplitAllocations(
        splitRows,
        splitMode,
        amountCents,
        selectableProjects,
      )
      if (built.error) {
        setError(built.error)
        return
      }
      allocations = built.allocations
    }

    onSave({
      type,
      amountCents,
      categoryId,
      accountId,
      date,
      note: note.trim().slice(0, 80),
      allocations,
    })
  }

  const handleDelete = () => {
    if (!editing) return
    onDelete(editing.id)
  }

  const splitSum = splitPreview.allocations.reduce(
    (total, line) => total + line.amountCents,
    0,
  )

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
              <span className="currency-mark">{activeCurrencySymbol()}</span>
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
            <legend className="field-label">归属</legend>
            <div className="scope-switch" role="group" aria-label="归属">
              {(
                [
                  ['daily', '日常'],
                  ['project', '项目'],
                  ['shared', '共用'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={scope === value ? 'is-active' : ''}
                  onClick={() => handleScopeChange(value)}
                  aria-pressed={scope === value}
                >
                  {label}
                </button>
              ))}
            </div>

            {scope === 'project' ? (
              selectableProjects.length > 0 ? (
                <label className="field project-field">
                  <span className="field-label">归属项目</span>
                  <select
                    value={projectId}
                    onChange={(event) => setProjectId(event.target.value)}
                  >
                    {selectableProjects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name}
                        {project.status === 'closed' ? '（已结束）' : ''}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <p className="project-empty">
                  还没有项目。请先在「设置 · 项目」中新建一个项目。
                </p>
              )
            ) : null}

            {scope === 'shared' ? (
              <div className="split-editor">
                <div className="split-head">
                  <span className="split-title">分摊明细</span>
                  <div
                    className="split-mode"
                    role="group"
                    aria-label="分摊方式"
                  >
                    <button
                      type="button"
                      className={splitMode === 'ratio' ? 'is-active' : ''}
                      onClick={() => handleSplitModeChange('ratio')}
                      aria-pressed={splitMode === 'ratio'}
                    >
                      按比例
                    </button>
                    <button
                      type="button"
                      className={splitMode === 'amount' ? 'is-active' : ''}
                      onClick={() => handleSplitModeChange('amount')}
                      aria-pressed={splitMode === 'amount'}
                    >
                      按金额
                    </button>
                  </div>
                </div>

                <div className="split-rows">
                  {splitRows.map((row) => (
                    <div className="split-row" key={row.id}>
                      <select
                        value={row.target}
                        onChange={(event) =>
                          handleSplitTargetChange(row.id, event.target.value)
                        }
                        aria-label="分摊归属"
                      >
                        <option value="daily">日常</option>
                        {selectableProjects.map((project) => (
                          <option
                            key={project.id}
                            value={`project:${project.id}`}
                          >
                            {project.name}
                            {project.status === 'closed' ? '（已结束）' : ''}
                          </option>
                        ))}
                      </select>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.value}
                        onChange={(event) =>
                          handleSplitValueChange(row.id, event.target.value)
                        }
                        aria-label="分摊数值"
                        placeholder="0"
                      />
                      <span className="split-suffix">
                        {splitMode === 'ratio' ? '%' : activeCurrencySymbol()}
                      </span>
                      {splitRows.length > 2 ? (
                        <button
                          type="button"
                          className="split-remove"
                          onClick={() => handleRemoveSplitRow(row.id)}
                          aria-label="删除这一项"
                        >
                          <Trash2 size={13} />
                        </button>
                      ) : (
                        <span className="split-spacer" />
                      )}
                    </div>
                  ))}
                </div>

                <div className="split-foot">
                  <button
                    type="button"
                    className="split-add"
                    onClick={handleAddSplitRow}
                    disabled={availableTargets.length === 0}
                  >
                    <Plus size={14} />
                    添加归属
                  </button>
                  <span
                    className={`split-summary${splitPreview.error ? ' is-error' : ''}`}
                  >
                    {splitPreview.error ||
                      `合计 ${formatMoney(splitSum / 100)}`}
                  </span>
                </div>

                {splitMode === 'ratio' ? (
                  <p className="split-hint">
                    比例按权重归一化，不必刚好 100%。共用支出会同时计入日常账和项目账。
                  </p>
                ) : null}
                {selectableProjects.length === 0 ? (
                  <p className="split-hint">
                    共用支出至少需要日常和一个项目。请先在设置中新建项目。
                  </p>
                ) : null}
              </div>
            ) : null}
          </fieldset>

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
