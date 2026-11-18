import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Pencil,
  PiggyBank,
  Plus,
  RefreshCw,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import {
  SAVINGS_KIND_LABELS,
  daysBetween,
  getGoalUsage,
  getSavingsSummary,
  getSavingsTotals,
  getInterestThisYear,
  getWeightedAnnualRateBps,
  sortedSavingsEntries,
} from '../lib/savings'
import {
  formatMoney,
  formatShortDate,
  localDateKey,
  monthShortLabel,
  shiftMonth,
} from '../lib/utils'
import { Goals } from './Goals'
import { DateInput } from '../components/DateInput'
import { SelectMenu } from '../components/SelectMenu'
import type { GoalPlanContext } from '../lib/goalPlans'
import type {
  Account,
  Category,
  LedgerTransaction,
  Project,
  ProjectDraft,
  SavingsDraft,
  SavingsEntryDraft,
  SavingsGoalDraft,
  SavingsGoalPlanDraft,
  SavingsGoalUpdateDraft,
  SavingsHolding,
  SavingsKind,
} from '../types'

interface SavingsProps {
  holdings: SavingsHolding[]
  accounts: Account[]
  projects: Project[]
  transactions: LedgerTransaction[]
  categories: Category[]
  goalPlanContext: GoalPlanContext
  remindersEnabled: boolean
  onCreate: (draft: SavingsDraft) => void
  onUpdate: (id: string, draft: SavingsDraft) => void
  onDelete: (id: string) => void
  onAddEntry: (holdingId: string, draft: SavingsEntryDraft) => void
  onDeleteEntry: (holdingId: string, entryId: string) => void
  onRenew: (holdingId: string) => void
  onCreateGoal: (draft: SavingsGoalDraft) => void
  onUpdateGoal: (id: string, draft: SavingsGoalUpdateDraft) => void
  onApplyGoalPlan: (id: string, plan: SavingsGoalPlanDraft) => void
  onStartGoal: (id: string) => void
  onSettleGoal: (
    id: string,
    options: {
      spentCents: number
      writeToFlow: boolean
      categoryId: string
      accountId: string
    },
  ) => void
  onCancelGoal: (id: string) => void
  onCreateProject: (draft: ProjectDraft) => string
  onOpenReminderSettings: () => void
}

interface EditorState {
  mode: 'create' | 'edit'
  id?: string
}

const KINDS: SavingsKind[] = [
  'fixed',
  'large',
  'bond',
  'wealth',
  'fund',
  'housing',
  'other',
]

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

function rateToInput(bps: number | undefined): string {
  if (!bps) return ''
  return (bps / 100).toFixed(2).replace(/\.?0+$/, '')
}

function isTermKind(kind: SavingsKind): boolean {
  return kind === 'fixed' || kind === 'large' || kind === 'bond'
}

function statusOf(
  summary: ReturnType<typeof getSavingsSummary>,
): { label: string; className: string } {
  if (summary.closed) return { label: '已关闭', className: 'is-settled' }
  if (summary.matured) return { label: '已到期', className: 'is-overdue' }
  if (
    summary.daysToMaturity !== null &&
    summary.daysToMaturity >= 0 &&
    summary.daysToMaturity <= 3
  ) {
    return { label: `${summary.daysToMaturity} 天后到期`, className: 'is-soon' }
  }
  return { label: '存续中', className: 'is-active' }
}

export function Savings({
  holdings,
  accounts,
  projects,
  transactions,
  categories,
  goalPlanContext,
  remindersEnabled,
  onCreate,
  onUpdate,
  onDelete,
  onAddEntry,
  onDeleteEntry,
  onRenew,
  onCreateGoal,
  onUpdateGoal,
  onApplyGoalPlan,
  onStartGoal,
  onSettleGoal,
  onCancelGoal,
  onCreateProject,
  onOpenReminderSettings,
}: SavingsProps) {
  const today = localDateKey()
  const goals = holdings.filter((holding) => holding.kind === 'goal')
  const assets = holdings.filter((holding) => holding.kind !== 'goal')
  const [view, setView] = useState<'goals' | 'assets'>(() =>
    goals.some((goal) => !goal.closedAt) ? 'goals' : 'assets',
  )
  const viewHoldings = view === 'goals' ? goals : assets
  const totals = getSavingsTotals(viewHoldings, today, transactions)
  const weightedRate = getWeightedAnnualRateBps(assets)
  const interestThisYear = getInterestThisYear(viewHoldings)
  const activeGoals = goals.filter(
    (goal) => !goal.closedAt && goal.goalStatus !== 'settled',
  )
  const goalTargetTotal = activeGoals.reduce(
    (sum, goal) => sum + (goal.goalTargetCents ?? 0),
    0,
  )
  const goalFundedCents = (goal: SavingsHolding): number => {
    const summary = getSavingsSummary(goal, today, transactions)
    const usage = getGoalUsage(goal, transactions, today)
    return summary.balanceCents + usage.coveredCents
  }
  const goalRemainingTotal = activeGoals.reduce((sum, goal) => {
    return (
      sum +
      Math.max((goal.goalTargetCents ?? 0) - goalFundedCents(goal), 0)
    )
  }, 0)
  const goalReachedCount = activeGoals.filter((goal) => {
    return goalFundedCents(goal) >= (goal.goalTargetCents ?? 0)
  }).length
  const reminderCandidates = assets.filter(
    (holding) => !holding.closedAt && holding.maturityDate,
  ).length
  const currentMonth = today.slice(0, 7)
  const maturityBuckets = Array.from({ length: 12 }, (_, index) => {
    const month = shiftMonth(currentMonth, index)
    let amountCents = 0
    let count = 0
    for (const holding of holdings) {
      if (holding.closedAt || !holding.maturityDate) continue
      if (holding.maturityDate.slice(0, 7) !== month) continue
      if (holding.maturityDate < today) continue
      amountCents += getSavingsSummary(holding, today).expectedMaturityCents
      count += 1
    }
    return { month, label: monthShortLabel(month), amountCents, count }
  })
  const maturityMax = Math.max(
    ...maturityBuckets.map((bucket) => bucket.amountCents),
    0,
  )
  const hasMaturityLadder = maturityBuckets.some(
    (bucket) => bucket.count > 0,
  )
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<SavingsKind>('fixed')
  const [institution, setInstitution] = useState('')
  const [principal, setPrincipal] = useState('')
  const [rate, setRate] = useState('')
  const [startDate, setStartDate] = useState(localDateKey())
  const [maturityDate, setMaturityDate] = useState('')
  const [autoRenew, setAutoRenew] = useState(false)
  const [note, setNote] = useState('')
  const [source, setSource] = useState<'ledger' | 'external'>('ledger')
  const [accountId, setAccountId] = useState('')
  const [formError, setFormError] = useState('')

  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [entryKind, setEntryKind] =
    useState<'deposit' | 'withdraw' | 'interest' | 'adjust'>('deposit')
  const [entryAmount, setEntryAmount] = useState('')
  const [entryDate, setEntryDate] = useState(localDateKey())
  const [entrySource, setEntrySource] =
    useState<'ledger' | 'external'>('ledger')
  const [entryAccount, setEntryAccount] = useState('')
  const [entryNote, setEntryNote] = useState('')
  const [entryError, setEntryError] = useState('')

  const openCreate = () => {
    setEditor({ mode: 'create' })
    setName('')
    setKind('fixed')
    setInstitution('')
    setPrincipal('')
    setRate('')
    setStartDate(localDateKey())
    setMaturityDate('')
    setAutoRenew(false)
    setNote('')
    setSource('ledger')
    setAccountId('')
    setFormError('')
  }

  const openEdit = (holding: SavingsHolding) => {
    setEditor({ mode: 'edit', id: holding.id })
    setName(holding.name)
    setKind(holding.kind)
    setInstitution(holding.institution ?? '')
    setPrincipal(centsToInput(holding.principalCents))
    setRate(rateToInput(holding.annualRateBps))
    setStartDate(holding.startDate)
    setMaturityDate(holding.maturityDate ?? '')
    setAutoRenew(Boolean(holding.autoRenew))
    setNote(holding.note ?? '')
    setSource('external')
    setFormError('')
  }

  const closeEditor = () => {
    setEditor(null)
    setFormError('')
  }

  const handleDelete = (holding: SavingsHolding) => {
    if (editor?.id === holding.id) closeEditor()
    if (expandedId === holding.id) setExpandedId(null)
    onDelete(holding.id)
  }

  const toggleExpanded = (id: string, term = false) => {
    setExpandedId((current) => (current === id ? null : id))
    setEntryKind(term ? 'withdraw' : 'deposit')
    setEntryAmount('')
    setEntryDate(localDateKey())
    setEntrySource('ledger')
    setEntryAccount('')
    setEntryNote('')
    setEntryError('')
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!editor) return
    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('给这笔储蓄起一个名字')
      return
    }
    if (trimmed.length > 40) {
      setFormError('名称最多 40 个字')
      return
    }
    if (!startDate) {
      setFormError('请选择起存日期')
      return
    }
    if (maturityDate && maturityDate <= startDate) {
      setFormError('到期日必须晚于起存日')
      return
    }
    if (isTermKind(kind) && !maturityDate) {
      setFormError('定期类储蓄请填写到期日，才能计算利息和提醒')
      return
    }
    const rateValue = rate.trim() === '' ? undefined : Number(rate)
    if (
      rateValue !== undefined &&
      (!Number.isFinite(rateValue) || rateValue < 0 || rateValue > 100)
    ) {
      setFormError('年化利率请填写 0 到 100 之间的数字')
      return
    }
    const principalCents = Math.round(Number(principal) * 100)
    if (
      editor.mode === 'create' &&
      (!Number.isFinite(principalCents) || principalCents <= 0)
    ) {
      setFormError('请输入大于 0 的本金')
      return
    }
    const holding = editor.id
      ? holdings.find((item) => item.id === editor.id)
      : undefined
    const draft: SavingsDraft = {
      name: trimmed,
      kind,
      ...(institution.trim() ? { institution: institution.trim() } : {}),
      principalCents:
        editor.mode === 'edit' && holding
          ? holding.principalCents
          : principalCents,
      ...(rateValue !== undefined && rateValue > 0
        ? { annualRateBps: Math.round(rateValue * 100) }
        : {}),
      startDate,
      ...(maturityDate ? { maturityDate } : {}),
      ...(autoRenew ? { autoRenew: true } : {}),
      ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}),
      source: editor.mode === 'edit' ? 'external' : source,
      ...(editor.mode === 'create' && source === 'ledger' && accountId
        ? { accountId }
        : {}),
    }
    if (editor.mode === 'edit' && editor.id) onUpdate(editor.id, draft)
    else onCreate(draft)
    closeEditor()
  }

  const handleEntrySubmit = (
    event: FormEvent,
    holding: SavingsHolding,
  ) => {
    event.preventDefault()
    const summary = getSavingsSummary(holding, today)
    if (entryKind === 'adjust') {
      if (!entryAmount.trim()) {
        setEntryError('请输入最新余额')
        return
      }
      const nextBalance = Math.round(Number(entryAmount) * 100)
      if (!Number.isFinite(nextBalance) || nextBalance < 0) {
        setEntryError('请输入不小于 0 的最新余额')
        return
      }
      const delta = nextBalance - summary.balanceCents
      if (delta === 0) {
        setEntryError('余额没有变化')
        return
      }
      onAddEntry(holding.id, {
        kind: 'adjust',
        amountCents: delta,
        date: entryDate,
        ...(entryNote.trim() ? { note: entryNote.trim().slice(0, 200) } : {}),
      })
    } else {
      const amountCents = Math.round(Number(entryAmount) * 100)
      if (!Number.isFinite(amountCents) || amountCents <= 0) {
        setEntryError('请输入大于 0 的金额')
        return
      }
      if (entryKind === 'withdraw' && amountCents > summary.balanceCents) {
        setEntryError(
          `取出金额不能超过当前余额 ${formatMoney(
            summary.balanceCents / 100,
          )}`,
        )
        return
      }
      if (!entryDate) {
        setEntryError('请选择日期')
        return
      }
      onAddEntry(holding.id, {
        kind: entryKind,
        amountCents,
        date: entryDate,
        ...(entryKind === 'deposit' ? { source: entrySource } : {}),
        ...(entryAccount ? { accountId: entryAccount } : {}),
        ...(entryNote.trim() ? { note: entryNote.trim().slice(0, 200) } : {}),
      })
    }
    setEntryAmount('')
    setEntryDate(localDateKey())
    setEntryNote('')
    setEntryError('')
  }

  return (
    <div className="page-stack savings-page">
      <section className="card liability-summary" aria-label="储蓄概览">
        {view === 'goals' ? (
          <>
            <div className="summary-cell">
              <span>目标总额</span>
              <strong>{formatMoney(goalTargetTotal / 100)}</strong>
            </div>
            <div className="summary-cell">
              <span>当前余额</span>
              <strong className="is-income">
                {formatMoney(totals.balanceCents / 100)}
              </strong>
            </div>
            <div className="summary-cell">
              <span>还差</span>
              <strong>{formatMoney(goalRemainingTotal / 100)}</strong>
            </div>
            <div className="summary-cell summary-cell--count">
              <span>已达标</span>
              <strong>
                {goalReachedCount} / {activeGoals.length}
              </strong>
            </div>
          </>
        ) : (
          <>
            <div className="summary-cell">
              <span>储蓄总额</span>
              <strong>{formatMoney(totals.balanceCents / 100)}</strong>
            </div>
            <div className="summary-cell">
              <span>加权年化</span>
              <strong>
                {weightedRate === null
                  ? '—'
                  : `${(weightedRate / 100).toFixed(2)}%`}
              </strong>
            </div>
            <div className="summary-cell">
              <span>今年利息</span>
              <strong className="is-income">
                {formatMoney(interestThisYear / 100)}
              </strong>
            </div>
            <div className="summary-cell summary-cell--count">
              <span>待处理到期</span>
              <strong>{totals.dueSoonCount + totals.maturedCount} 笔</strong>
            </div>
          </>
        )}
      </section>

      <div className="savings-subtabs" role="tablist" aria-label="储蓄分类">
        <button
          type="button"
          role="tab"
          aria-selected={view === 'goals'}
          className={view === 'goals' ? 'is-active' : ''}
          onClick={() => setView('goals')}
        >
          <Target size={15} />
          目标储蓄
          <span>{activeGoals.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === 'assets'}
          className={view === 'assets' ? 'is-active' : ''}
          onClick={() => setView('assets')}
        >
          <PiggyBank size={15} />
          储蓄资产
          <span>{assets.filter((holding) => !holding.closedAt).length}</span>
        </button>
        <p className="savings-subtabs-note">
          目标用于某事，资产是定期存款等钱本身
        </p>
      </div>

      {!remindersEnabled && reminderCandidates > 0 && view === 'assets' ? (
        <button
          type="button"
          className="savings-reminder-hint"
          onClick={onOpenReminderSettings}
        >
          <BellRing size={15} />
          <span>
            开启到期提醒：到期前 3 天和到期当天各提醒一次，接入系统通知。
          </span>
          <ChevronDown size={14} aria-hidden />
        </button>
      ) : null}

      {view === 'goals' ? (
        <Goals
          goals={goals}
          projects={projects}
          accounts={accounts}
          categories={categories}
          transactions={transactions}
          goalPlanContext={goalPlanContext}
          onCreate={onCreateGoal}
          onUpdate={onUpdateGoal}
          onApplyPlan={onApplyGoalPlan}
          onStart={onStartGoal}
          onSettle={onSettleGoal}
          onCancel={onCancelGoal}
          onDelete={onDelete}
          onDeposit={(id, draft) => onAddEntry(id, draft)}
          onCreateProject={onCreateProject}
        />
      ) : (
        <>
      <section className="card liability-panel">
        <div className="liability-panel-head">
          <div>
            <p className="card-kicker">存与取</p>
            <h2>储蓄资产</h2>
            <p className="card-sub">
              记录定期存款和账外储蓄，自动计算余额、到期本息与到期日。
            </p>
          </div>
          <button type="button" className="button primary" onClick={openCreate}>
            <Plus size={16} />
            新增储蓄
          </button>
        </div>

        {editor ? (
          <form className="liability-editor" onSubmit={handleSubmit}>
            <div className="liability-editor-head">
              <strong>
                {editor.mode === 'edit' ? '编辑储蓄' : '新增储蓄'}
              </strong>
              <button
                type="button"
                className="icon-button"
                onClick={closeEditor}
                aria-label="关闭储蓄编辑"
              >
                <X size={17} />
              </button>
            </div>
            <div className="savings-form-grid">
              <label className="field">
                <span className="field-label">名称</span>
                <input
                  type="text"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value)
                    setFormError('')
                  }}
                  placeholder="例如：招行 3 年定期"
                  maxLength={40}
                />
              </label>
              <div className="field">
                <span className="field-label">类型</span>
                <SelectMenu
                  value={kind}
                  options={KINDS.map((item) => ({
                    value: item,
                    label: SAVINGS_KIND_LABELS[item],
                  }))}
                  onChange={(next) => {
                    setKind(next as SavingsKind)
                    setFormError('')
                  }}
                  ariaLabel="储蓄类型"
                  elevated
                />
              </div>
              <label className="field">
                <span className="field-label">
                  机构 <span className="optional">选填</span>
                </span>
                <input
                  type="text"
                  value={institution}
                  onChange={(event) => setInstitution(event.target.value)}
                  placeholder="招商银行、余额宝…"
                  maxLength={40}
                />
              </label>
            </div>

            <div className="savings-form-grid">
              <label className="field">
                <span className="field-label">
                  {editor.mode === 'edit' ? '起存本金' : '本金 / 初始余额'}
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={principal}
                  onChange={(event) => {
                    setPrincipal(sanitizeMoney(event.target.value))
                    setFormError('')
                  }}
                  placeholder="0.00"
                  readOnly={editor.mode === 'edit'}
                />
              </label>
              <label className="field">
                <span className="field-label">
                  年化利率 % <span className="optional">选填</span>
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={rate}
                  onChange={(event) => {
                    setRate(sanitizeMoney(event.target.value))
                    setFormError('')
                  }}
                  placeholder="2.60"
                />
              </label>
              <label className="field">
                <span className="field-label">起存日</span>
                <DateInput
                  value={startDate}
                  max={localDateKey()}
                  ariaLabel="起存日"
                  onChange={(next) => {
                    setStartDate(next)
                    setFormError('')
                  }}
                />
              </label>
              <label className="field">
                <span className="field-label">
                  到期日{' '}
                  {isTermKind(kind) ? null : (
                    <span className="optional">选填</span>
                  )}
                </span>
                <DateInput
                  value={maturityDate}
                  min={startDate || undefined}
                  ariaLabel="到期日"
                  onChange={(next) => {
                    setMaturityDate(next)
                    setFormError('')
                  }}
                />
              </label>
            </div>

            {editor.mode === 'create' ? (
              <div className="savings-form-grid">
                <div className="field">
                  <span className="field-label">资金来源</span>
                  <SelectMenu
                    value={source}
                    options={[
                      { value: 'ledger', label: '从账本流动资金转入' },
                      { value: 'external', label: '账外已有储蓄' },
                    ]}
                    onChange={(next) => {
                      setSource(next as 'ledger' | 'external')
                      setFormError('')
                    }}
                    ariaLabel="资金来源"
                    elevated
                  />
                </div>
                {source === 'ledger' ? (
                  <div className="field">
                    <span className="field-label">
                      流动资金账户 <span className="optional">选填</span>
                    </span>
                    <SelectMenu
                      value={accountId}
                      options={accounts.map((account) => ({
                        value: account.id,
                        label: account.name,
                      }))}
                      onChange={setAccountId}
                      ariaLabel="流动资金账户"
                      allLabel="不指定"
                      elevated
                    />
                  </div>
                ) : null}
                <label className="field field--checkbox">
                  <input
                    type="checkbox"
                    checked={autoRenew}
                    onChange={(event) => setAutoRenew(event.target.checked)}
                  />
                  <span>到期自动转存（仅作提醒标记）</span>
                </label>
              </div>
            ) : (
              <label className="field field--checkbox">
                <input
                  type="checkbox"
                  checked={autoRenew}
                  onChange={(event) => setAutoRenew(event.target.checked)}
                />
                <span>到期自动转存（仅作提醒标记）</span>
              </label>
            )}

            <label className="field">
              <span className="field-label">
                备注 <span className="optional">选填</span>
              </span>
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="利率、到期后打算，或一句提醒"
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
                {editor.mode === 'edit' ? '保存修改' : '记下这笔储蓄'}
              </button>
            </div>
          </form>
        ) : null}

        {assets.length === 0 && !editor ? (
          <div className="liability-empty">
            <div className="empty-mark" aria-hidden="true">
              <PiggyBank size={22} />
            </div>
            <h2>还没有记录储蓄</h2>
            <p>
              定期存款、大额存单、公积金或货币基金都可以记在这里。账外的钱不占流动资金，账内转入会自动生成一笔转账。
            </p>
            <button type="button" className="button primary" onClick={openCreate}>
              <Plus size={16} />
              记下第一笔储蓄
            </button>
          </div>
        ) : (
          <div className="liability-list">
            {assets.map((holding) => {
              const summary = getSavingsSummary(holding, today)
              const status = statusOf(summary)
              const expanded = expandedId === holding.id
              const term = isTermKind(holding.kind)
              const entries = sortedSavingsEntries(holding)
              const termDays = holding.maturityDate
                ? daysBetween(holding.startDate, holding.maturityDate)
                : 0
              return (
                <article
                  className={`liability-item savings-item${summary.matured ? ' is-overdue' : ''}${summary.closed ? ' is-settled' : ''}`}
                  key={holding.id}
                >
                  <div className="liability-item-head">
                    <div className="liability-title">
                      <strong>{holding.name}</strong>
                      <span className={`liability-status ${status.className}`}>
                        {status.label}
                      </span>
                      <span className="savings-kind-pill">
                        {SAVINGS_KIND_LABELS[holding.kind]}
                      </span>
                    </div>
                    <div className="liability-item-actions">
                      {summary.matured && !summary.closed ? (
                        <button
                          type="button"
                          className="row-action"
                          onClick={() => onRenew(holding.id)}
                          aria-label={`续存${holding.name}`}
                          title="本息续存"
                        >
                          <RefreshCw size={15} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="row-action"
                        onClick={() => openEdit(holding)}
                        aria-label={`编辑${holding.name}`}
                        title="编辑"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        type="button"
                        className="row-action row-action--danger"
                        onClick={() => handleDelete(holding)}
                        aria-label={`删除${holding.name}`}
                        title="删除"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>

                  <div className="liability-metrics">
                    <div>
                      <span>当前余额</span>
                      <strong>{formatMoney(summary.balanceCents / 100)}</strong>
                    </div>
                    <div>
                      <span>预计到期本息</span>
                      <strong>
                        {holding.maturityDate
                          ? formatMoney(summary.expectedMaturityCents / 100)
                          : '—'}
                      </strong>
                    </div>
                    <div>
                      <span>年化</span>
                      <strong>
                        {holding.annualRateBps
                          ? `${(holding.annualRateBps / 100).toFixed(2)}%`
                          : '—'}
                      </strong>
                    </div>
                  </div>

                  {holding.maturityDate && !summary.closed ? (
                    <div className="liability-meter" aria-hidden="true">
                      <span
                        style={{ width: `${summary.termProgress * 100}%` }}
                      />
                    </div>
                  ) : null}

                  <div className="liability-meta">
                    <span>
                      {holding.startDate} 起存
                      {holding.maturityDate
                        ? ` · ${
                            summary.matured
                              ? '已到期'
                              : `还有 ${summary.daysToMaturity} 天到期`
                          }`
                        : ' · 无固定期限'}
                    </span>
                    {termDays > 0 ? <span>存期 {termDays} 天</span> : null}
                    <span>{entries.length} 条记录</span>
                    {holding.institution ? (
                      <span>{holding.institution}</span>
                    ) : null}
                    {holding.autoRenew ? <span>到期转存</span> : null}
                    {holding.note ? (
                      <span className="liability-note">{holding.note}</span>
                    ) : null}
                  </div>

                  {!summary.closed ? (
                    term && !summary.matured ? (
                      <p className="savings-term-hint">
                        定期存款在到期前不能中途存入或取出；到期后可记利息、取出或续存。
                      </p>
                    ) : expanded ? (
                      <>
                        <form
                          className="repayment-form savings-entry-form"
                          onSubmit={(event) =>
                            handleEntrySubmit(event, holding)
                          }
                        >
                          <SelectMenu
                            value={entryKind}
                            options={[
                              ...(!term
                                ? [{ value: 'deposit', label: '存入' }]
                                : []),
                              { value: 'withdraw', label: '取出' },
                              { value: 'interest', label: '利息' },
                              ...(!term && !holding.maturityDate
                                ? [{ value: 'adjust', label: '更新余额' }]
                                : []),
                            ]}
                            onChange={(next) => {
                              setEntryKind(
                                next as
                                  | 'deposit'
                                  | 'withdraw'
                                  | 'interest'
                                  | 'adjust',
                              )
                              setEntryError('')
                            }}
                            ariaLabel="记录类型"
                            className="savings-entry-select"
                          />
                          <input
                            type="text"
                            inputMode="decimal"
                            value={entryAmount}
                            onChange={(event) => {
                              setEntryAmount(
                                sanitizeMoney(event.target.value),
                              )
                              setEntryError('')
                            }}
                            placeholder={
                              entryKind === 'adjust'
                                ? '最新余额'
                                : entryKind === 'interest'
                                  ? '利息金额'
                                  : '金额'
                            }
                            aria-label={
                              entryKind === 'adjust' ? '最新余额' : '金额'
                            }
                          />
                          <DateInput
                            value={entryDate}
                            max={localDateKey()}
                            ariaLabel="日期"
                            onChange={(next) => {
                              setEntryDate(next)
                              setEntryError('')
                            }}
                          />
                          {entryKind === 'deposit' ? (
                            <SelectMenu
                              value={entrySource}
                              options={[
                                { value: 'ledger', label: '从流动资金转入' },
                                { value: 'external', label: '账外资金' },
                              ]}
                              onChange={(next) =>
                                setEntrySource(next as 'ledger' | 'external')
                              }
                              ariaLabel="资金来源"
                              className="savings-entry-select"
                            />
                          ) : null}
                          {entryKind === 'deposit' ||
                          entryKind === 'withdraw' ? (
                            <SelectMenu
                              value={entryAccount}
                              options={accounts.map((account) => ({
                                value: account.id,
                                label: account.name,
                              }))}
                              onChange={setEntryAccount}
                              ariaLabel="流动资金账户"
                              allLabel="不指定账户"
                              className="savings-entry-select"
                            />
                          ) : null}
                          <input
                            type="text"
                            value={entryNote}
                            onChange={(event) =>
                              setEntryNote(event.target.value)
                            }
                            placeholder="备注（选填）"
                            maxLength={200}
                            aria-label="备注"
                          />
                          <button type="submit" className="button secondary">
                            记下
                          </button>
                        </form>
                        <p className="repayment-hint">
                          {term
                            ? '定期到期后可以记录利息或取出；取出后如需继续存，请在卡片上点续存。'
                            : '存入和取出是转账，不计入收入或支出；取出后如果用于消费，请再到流水里记一笔支出。'}
                        </p>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="liability-repay-trigger"
                        onClick={() => toggleExpanded(holding.id, term)}
                      >
                        <Plus size={14} />
                        {term ? '记利息或取出' : '记一笔存入或取出'}
                      </button>
                    )
                  ) : null}

                  {entryError && expanded ? (
                    <p className="form-error" role="alert">
                      {entryError}
                    </p>
                  ) : null}

                  <button
                    type="button"
                    className="liability-history-toggle"
                    onClick={() => toggleExpanded(holding.id, term)}
                    aria-expanded={expanded}
                  >
                    {expanded ? (
                      <ChevronUp size={14} />
                    ) : (
                      <ChevronDown size={14} />
                    )}
                    存入与利息记录
                    <span>{entries.length}</span>
                  </button>

                  {expanded ? (
                    entries.length > 0 ? (
                      <ul className="repayment-list">
                        {entries.map((entry) => {
                          const signed =
                            entry.kind === 'withdraw'
                              ? -entry.amountCents
                              : entry.amountCents
                          const label =
                            entry.kind === 'deposit'
                              ? entry.source === 'ledger'
                                ? '存入 · 从流动资金'
                                : '存入 · 账外'
                              : entry.kind === 'withdraw'
                                ? '取出 · 回到流动资金'
                                : entry.kind === 'interest'
                                  ? '利息'
                                  : signed >= 0
                                    ? '余额上调'
                                    : '余额下调'
                          return (
                            <li key={entry.id}>
                              <span className="repayment-date">
                                {formatShortDate(entry.date)}
                              </span>
                              <span className="repayment-note">
                                {entry.note || label}
                              </span>
                              <strong
                                className={signed < 0 ? 'is-negative' : ''}
                              >
                                {signed < 0 ? '−' : '+'}
                                {formatMoney(Math.abs(signed) / 100)}
                              </strong>
                              {!summary.closed ? (
                                <button
                                  type="button"
                                  className="row-action row-action--danger"
                                  onClick={() =>
                                    onDeleteEntry(holding.id, entry.id)
                                  }
                                  aria-label="删除这条储蓄记录"
                                  title="删除"
                                >
                                  <Trash2 size={14} />
                                </button>
                              ) : null}
                            </li>
                          )
                        })}
                      </ul>
                    ) : (
                      <p className="repayment-empty">还没有记录。</p>
                    )
                  ) : null}
                </article>
              )
            })}
          </div>
        )}
      </section>

      {hasMaturityLadder ? (
        <section className="card savings-ladder-card" aria-label="到期日历">
          <div className="savings-overview-head">
            <div>
              <p className="card-kicker">MATURITY LADDER</p>
              <h2>到期日历</h2>
              <p className="card-sub">
                未来 12 个月的到期金额，按月份铺开；到期的钱可以先想好去处。
              </p>
            </div>
            <span className="savings-ladder-total">
              {formatMoney(
                maturityBuckets.reduce(
                  (sum, bucket) => sum + bucket.amountCents,
                  0,
                ) / 100,
              )}
            </span>
          </div>
          <div className="savings-ladder-list">
            {maturityBuckets.map((bucket) => (
              <div className="savings-ladder-row" key={bucket.month}>
                <span>{bucket.label}</span>
                <div className="savings-ladder-bar" aria-hidden="true">
                  <span
                    style={{
                      width:
                        maturityMax > 0
                          ? `${(bucket.amountCents / maturityMax) * 100}%`
                          : '0%',
                    }}
                  />
                </div>
                <strong>
                  {bucket.count > 0
                    ? formatMoney(bucket.amountCents / 100)
                    : '—'}
                </strong>
                <small>{bucket.count > 0 ? `${bucket.count} 笔` : ''}</small>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card savings-note-card">
        <CalendarClock size={16} aria-hidden />
        <div>
          <strong>到期后记得处理</strong>
          <p>
            定期到期后，可以在卡片上点续存，或记一笔取出转回流动资金。已到期的存单会一直排在列表前面，直到处理或关闭。
          </p>
        </div>
        <CheckCircle2 size={16} aria-hidden />
      </section>
        </>
      )}
    </div>
  )
}
