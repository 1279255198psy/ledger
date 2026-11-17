import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  FolderPlus,
  Pencil,
  PiggyBank,
  Play,
  Plus,
  Target,
  Trash2,
  X,
} from 'lucide-react'
import {
  getGoalUsage,
  getSavingsSummary,
  sortedSavingsEntries,
  sortSavingsGoals,
} from '../lib/savings'
import { buildGoalPlans } from '../lib/goalPlans'
import {
  formatMoney,
  formatShortDate,
  localDateKey,
} from '../lib/utils'
import type {
  Account,
  Category,
  LedgerTransaction,
  Project,
  ProjectDraft,
  SavingsEntryDraft,
  SavingsGoalDraft,
  SavingsGoalUpdateDraft,
  SavingsHolding,
} from '../types'

interface GoalsProps {
  goals: SavingsHolding[]
  projects: Project[]
  accounts: Account[]
  categories: Category[]
  transactions: LedgerTransaction[]
  monthlySurplusCents: number
  onCreate: (draft: SavingsGoalDraft) => void
  onUpdate: (id: string, draft: SavingsGoalUpdateDraft) => void
  onStart: (id: string) => void
  onSettle: (
    id: string,
    options: {
      spentCents: number
      writeToFlow: boolean
      categoryId: string
      accountId: string
    },
  ) => void
  onCancel: (id: string) => void
  onDelete: (id: string) => void
  onDeposit: (id: string, draft: SavingsEntryDraft) => void
  onCreateProject: (draft: ProjectDraft) => string
}

interface EditorState {
  mode: 'create' | 'edit'
  id?: string
}

interface ProjectDraftState {
  name: string
  endDate: string
  budget: string
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

function formatMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  return `${year} 年 ${Number(month)} 月`
}

function defaultSplitCategory(categories: Category[]): string {
  return (
    categories.find(
      (category) => category.id === 'other_expense' && !category.parentId,
    )?.id ??
    categories.find(
      (category) => category.type === 'expense' && !category.parentId,
    )?.id ??
    ''
  )
}

export function Goals({
  goals,
  projects,
  accounts,
  categories,
  transactions,
  monthlySurplusCents,
  onCreate,
  onUpdate,
  onStart,
  onSettle,
  onCancel,
  onDelete,
  onDeposit,
  onCreateProject,
}: GoalsProps) {
  const today = localDateKey()
  const sortedGoals = sortSavingsGoals(goals)
  const activeGoals = sortedGoals.filter(
    (goal) => !goal.closedAt && goal.goalStatus !== 'settled',
  )
  const closedGoals = sortedGoals.filter(
    (goal) => goal.closedAt || goal.goalStatus === 'settled',
  )
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [projectId, setProjectId] = useState('')
  const [initial, setInitial] = useState('')
  const [source, setSource] = useState<'ledger' | 'external'>('ledger')
  const [accountId, setAccountId] = useState('')
  const [note, setNote] = useState('')
  const [formError, setFormError] = useState('')
  const [projectFormOpen, setProjectFormOpen] = useState(false)
  const [projectDraft, setProjectDraft] = useState<ProjectDraftState>({
    name: '',
    endDate: '',
    budget: '',
  })
  const [projectError, setProjectError] = useState('')

  const [depositFor, setDepositFor] = useState<string | null>(null)
  const [depositAmount, setDepositAmount] = useState('')
  const [depositDate, setDepositDate] = useState(localDateKey())
  const [depositSource, setDepositSource] =
    useState<'ledger' | 'external'>('ledger')
  const [depositAccount, setDepositAccount] = useState('')
  const [depositNote, setDepositNote] = useState('')
  const [depositError, setDepositError] = useState('')

  const [settleFor, setSettleFor] = useState<string | null>(null)
  const [spentInput, setSpentInput] = useState('')
  const [writeToFlow, setWriteToFlow] = useState(true)
  const [settleCategory, setSettleCategory] = useState(() =>
    defaultSplitCategory(categories),
  )
  const [settleAccount, setSettleAccount] = useState('')
  const [settleError, setSettleError] = useState('')

  const goalProjects = projects.filter(
    (project) =>
      project.id === projectId ||
      (!project.archivedAt &&
        !activeGoals.some((goal) => goal.goalProjectId === project.id)),
  )
  const targetCents = Math.round(Number(target) * 100)
  const editorHolding = editor?.id
    ? goals.find((goal) => goal.id === editor.id)
    : undefined
  const currentBalance = editorHolding
    ? getSavingsSummary(editorHolding, today, transactions).balanceCents
    : 0
  const remaining =
    Number.isFinite(targetCents) && targetCents > currentBalance
      ? targetCents - currentBalance
      : 0
  const plans = buildGoalPlans(
    remaining,
    monthlySurplusCents,
    targetDate || undefined,
    today,
  )

  const openCreate = () => {
    setEditor({ mode: 'create' })
    setName('')
    setTarget('')
    setTargetDate('')
    setProjectId('')
    setInitial('')
    setSource('ledger')
    setAccountId('')
    setNote('')
    setFormError('')
    setProjectFormOpen(false)
    setProjectDraft({ name: '', endDate: '', budget: '' })
    setProjectError('')
  }

  const openEdit = (goal: SavingsHolding) => {
    setEditor({ mode: 'edit', id: goal.id })
    setName(goal.name)
    setTarget(centsToInput(goal.goalTargetCents ?? 0))
    setTargetDate(goal.goalDate ?? '')
    setProjectId(goal.goalProjectId ?? '')
    setNote(goal.note ?? '')
    setFormError('')
    setProjectFormOpen(false)
    setProjectError('')
  }

  const closeEditor = () => {
    setEditor(null)
    setFormError('')
    setProjectFormOpen(false)
  }

  const handleProjectSelect = (nextId: string) => {
    setProjectId(nextId)
    const project = projects.find((item) => item.id === nextId)
    if (project?.budgetCents && !target.trim()) {
      setTarget(centsToInput(project.budgetCents))
    }
  }

  const handleProjectCreate = (event?: { preventDefault: () => void }) => {
    event?.preventDefault()
    const projectName = projectDraft.name.trim()
    if (!projectName) {
      setProjectError('给项目起一个名字')
      return
    }
    const budgetCents = projectDraft.budget.trim()
      ? Math.round(Number(projectDraft.budget) * 100)
      : undefined
    if (
      budgetCents !== undefined &&
      (!Number.isFinite(budgetCents) || budgetCents < 0)
    ) {
      setProjectError('项目预算需要是大于等于 0 的金额')
      return
    }
    const id = onCreateProject({
      name: projectName,
      startDate: today,
      ...(projectDraft.endDate ? { endDate: projectDraft.endDate } : {}),
      ...(budgetCents && budgetCents > 0 ? { budgetCents } : {}),
    })
    setProjectId(id)
    if (budgetCents && budgetCents > 0 && !target.trim()) {
      setTarget(centsToInput(budgetCents))
    }
    setProjectFormOpen(false)
    setProjectDraft({ name: '', endDate: '', budget: '' })
    setProjectError('')
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!editor) return
    const trimmed = name.trim()
    if (!trimmed) {
      setFormError('给这个目标起一个名字')
      return
    }
    if (trimmed.length > 40) {
      setFormError('名称最多 40 个字')
      return
    }
    const amountCents = Math.round(Number(target) * 100)
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setFormError('请输入大于 0 的目标金额')
      return
    }
    if (editor.mode === 'edit' && editor.id) {
      onUpdate(editor.id, {
        name: trimmed,
        targetCents: amountCents,
        ...(targetDate ? { targetDate } : {}),
        ...(projectId ? { projectId } : {}),
        ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}),
      })
      closeEditor()
      return
    }
    const initialCents = Math.round(Number(initial) * 100)
    if (!Number.isFinite(initialCents) || initialCents < 0) {
      setFormError('初始存入需要是大于等于 0 的金额')
      return
    }
    onCreate({
      name: trimmed,
      targetCents: amountCents,
      ...(targetDate ? { targetDate } : {}),
      ...(projectId ? { projectId } : {}),
      startDate: today,
      initialCents,
      source,
      ...(accountId ? { accountId } : {}),
      ...(note.trim() ? { note: note.trim().slice(0, 200) } : {}),
    })
    closeEditor()
  }

  const openDeposit = (goal: SavingsHolding) => {
    setDepositFor(goal.id)
    setDepositAmount('')
    setDepositDate(localDateKey())
    setDepositSource('ledger')
    setDepositAccount('')
    setDepositNote('')
    setDepositError('')
  }

  const handleDeposit = (event: FormEvent, goal: SavingsHolding) => {
    event.preventDefault()
    const amountCents = Math.round(Number(depositAmount) * 100)
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      setDepositError('请输入大于 0 的金额')
      return
    }
    onDeposit(goal.id, {
      kind: 'deposit',
      amountCents,
      date: depositDate,
      source: depositSource,
      ...(depositAccount ? { accountId: depositAccount } : {}),
      ...(depositNote.trim() ? { note: depositNote.trim().slice(0, 200) } : {}),
    })
    setDepositFor(null)
  }

  const openSettle = (
    goal: SavingsHolding,
    usage: ReturnType<typeof getGoalUsage>,
  ) => {
    setSettleFor(goal.id)
    setSpentInput(
      goal.goalProjectId ? centsToInput(usage.rawSpendCents) : '0',
    )
    setWriteToFlow(!goal.goalProjectId)
    setSettleCategory(defaultSplitCategory(categories))
    setSettleAccount(accounts[0]?.id ?? '')
    setSettleError('')
  }

  const handleSettle = (event: FormEvent, goal: SavingsHolding) => {
    event.preventDefault()
    const usage = getGoalUsage(goal, transactions, today)
    const spentCents = goal.goalProjectId
      ? usage.rawSpendCents
      : Math.round(Number(spentInput) * 100)
    if (!Number.isFinite(spentCents) || spentCents < 0) {
      setSettleError('请输入不小于 0 的支出金额')
      return
    }
    if (!goal.goalProjectId && !writeToFlow) {
      const available = getSavingsSummary(
        goal,
        today,
        transactions,
      ).balanceCents
      if (spentCents > available) {
        setSettleError('不写入流水时，实际花掉不能超过储蓄余额')
        return
      }
    }
    if (!goal.goalProjectId && writeToFlow && !settleCategory) {
      setSettleError('请选择这笔支出记到哪个分类')
      return
    }
    if (!goal.goalProjectId && writeToFlow && !settleAccount) {
      setSettleError('请选择从哪个账户支出')
      return
    }
    onSettle(goal.id, {
      spentCents,
      writeToFlow: goal.goalProjectId ? true : writeToFlow,
      categoryId: settleCategory,
      accountId: settleAccount,
    })
    setSettleFor(null)
  }

  return (
    <div className="goals-section">
      <section className="savings-toolbar">
        <div>
          <p className="card-kicker">GOAL SAVINGS</p>
          <h2>目标储蓄</h2>
          <p className="card-sub">
            为一件事单独攒钱；可以关联项目，让项目支出直接从这笔储蓄里走。
          </p>
        </div>
        <button type="button" className="button primary" onClick={openCreate}>
          <Plus size={16} />
          新建目标
        </button>
      </section>

      {editor ? (
        <form className="liability-editor goal-editor" onSubmit={handleSubmit}>
          <div className="liability-editor-head">
            <strong>
              {editor.mode === 'edit' ? '编辑目标' : '新建目标'}
            </strong>
            <button
              type="button"
              className="icon-button"
              onClick={closeEditor}
              aria-label="关闭目标编辑"
            >
              <X size={17} />
            </button>
          </div>

          <div className="savings-form-grid">
            <label className="field">
              <span className="field-label">目标名称</span>
              <input
                type="text"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  setFormError('')
                }}
                placeholder="例如：换电脑、旅行基金"
                maxLength={40}
              />
            </label>
            <label className="field">
              <span className="field-label">目标金额</span>
              <input
                type="text"
                inputMode="decimal"
                value={target}
                onChange={(event) => {
                  setTarget(sanitizeMoney(event.target.value))
                  setFormError('')
                }}
                placeholder="0.00"
              />
            </label>
            <label className="field">
              <span className="field-label">
                目标日期 <span className="optional">选填</span>
              </span>
              <input
                type="date"
                value={targetDate}
                min={today}
                onChange={(event) => {
                  setTargetDate(event.target.value)
                  setFormError('')
                }}
              />
            </label>
            <label className="field">
              <span className="field-label">
                关联项目 <span className="optional">选填</span>
              </span>
              <select
                value={projectId}
                onChange={(event) => handleProjectSelect(event.target.value)}
                disabled={editorHolding?.goalStatus === 'using'}
              >
                <option value="">不关联项目</option>
                {goalProjects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {editorHolding?.goalStatus === 'using' ? (
            <p className="goal-hint">
              目标正在使用中，关联项目不能更换；如需换项目，请先取消目标。
            </p>
          ) : null}

          <div className="goal-project-create">
            {!projectFormOpen ? (
              <button
                type="button"
                className="button ghost"
                onClick={() => {
                  setProjectFormOpen(true)
                  setProjectDraft({
                    name: name ? `${name}项目` : '',
                    endDate: targetDate,
                    budget: target,
                  })
                }}
              >
                <FolderPlus size={14} />
                没有合适的项目？直接新建
              </button>
            ) : (
              <form className="goal-project-form" onSubmit={handleProjectCreate}>
                <div className="goal-project-form-row">
                  <label className="field">
                    <span className="field-label">项目名称</span>
                    <input
                      type="text"
                      value={projectDraft.name}
                      onChange={(event) =>
                        setProjectDraft((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      maxLength={40}
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">结束日期</span>
                    <input
                      type="date"
                      value={projectDraft.endDate}
                      min={today}
                      onChange={(event) =>
                        setProjectDraft((current) => ({
                          ...current,
                          endDate: event.target.value,
                        }))
                      }
                    />
                  </label>
                  <label className="field">
                    <span className="field-label">项目预算</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={projectDraft.budget}
                      onChange={(event) =>
                        setProjectDraft((current) => ({
                          ...current,
                          budget: sanitizeMoney(event.target.value),
                        }))
                      }
                    />
                  </label>
                </div>
                {projectError ? (
                  <p className="form-error" role="alert">
                    {projectError}
                  </p>
                ) : null}
                <div className="goal-project-form-actions">
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => setProjectFormOpen(false)}
                  >
                    取消
                  </button>
                  <button type="submit" className="button secondary">
                    创建并选中
                  </button>
                </div>
              </form>
            )}
          </div>

          {editor.mode === 'create' ? (
            <div className="savings-form-grid">
              <label className="field">
                <span className="field-label">
                  初始存入 <span className="optional">选填</span>
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={initial}
                  onChange={(event) => {
                    setInitial(sanitizeMoney(event.target.value))
                    setFormError('')
                  }}
                  placeholder="0.00"
                />
              </label>
              <label className="field">
                <span className="field-label">资金来源</span>
                <select
                  value={source}
                  onChange={(event) =>
                    setSource(event.target.value as 'ledger' | 'external')
                  }
                >
                  <option value="ledger">从流动资金转入</option>
                  <option value="external">账外已有资金</option>
                </select>
              </label>
              {source === 'ledger' ? (
                <label className="field">
                  <span className="field-label">账户</span>
                  <select
                    value={accountId}
                    onChange={(event) => setAccountId(event.target.value)}
                  >
                    <option value="">不指定</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          ) : null}

          <label className="field">
            <span className="field-label">
              备注 <span className="optional">选填</span>
            </span>
            <input
              type="text"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="为什么攒这笔钱，或达成后的打算"
              maxLength={200}
            />
          </label>

          {plans.length > 0 ? (
            <div className="goal-plans">
              <div className="goal-plans-head">
                <Target size={14} />
                <span>
                  近 6 个月平均结余 {formatMoney(monthlySurplusCents / 100)}，
                  可以参考这些节奏：
                </span>
              </div>
              <div className="goal-plan-list">
                {plans.map((plan) => (
                  <div key={plan.key} className="goal-plan">
                    <strong>{plan.label}</strong>
                    <span>每月 {formatMoney(plan.monthlyCents / 100)}</span>
                    <small>
                      约 {plan.months} 个月 · {formatMonth(plan.finishMonth)}
                    </small>
                  </div>
                ))}
              </div>
              <p className="goal-plan-note">{plans[0]?.detail}</p>
            </div>
          ) : null}

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
              {editor.mode === 'edit' ? '保存修改' : '创建目标'}
            </button>
          </div>
        </form>
      ) : null}

      {activeGoals.length === 0 && closedGoals.length === 0 && !editor ? (
        <div className="liability-empty">
          <div className="empty-mark" aria-hidden="true">
            <Target size={22} />
          </div>
          <h2>还没有目标</h2>
          <p>
            为换电脑、旅行或应急金单独攒一笔钱。关联项目后，项目支出会从这笔储蓄里扣，结束时剩余会自动返还流动资金。
          </p>
          <button type="button" className="button primary" onClick={openCreate}>
            <Plus size={16} />
            新建第一个目标
          </button>
        </div>
      ) : null}

      {activeGoals.length > 0 ? (
        <div className="goal-list">
          {activeGoals.map((goal) => {
            const summary = getSavingsSummary(goal, today, transactions)
            const usage = getGoalUsage(goal, transactions, today)
            const targetCentsValue = goal.goalTargetCents ?? 0
            const using = goal.goalStatus === 'using'
            const entries = sortedSavingsEntries(goal)
            const fundedCents =
              summary.balanceCents + (using ? usage.coveredCents : 0)
            const progress =
              targetCentsValue > 0
                ? Math.min(fundedCents / targetCentsValue, 1)
                : 0
            const project = projects.find(
              (item) => item.id === goal.goalProjectId,
            )
            const reached = fundedCents >= targetCentsValue
            const remainingCents = Math.max(
              targetCentsValue - fundedCents,
              0,
            )
            const plans = buildGoalPlans(
              remainingCents,
              monthlySurplusCents,
              goal.goalDate,
              today,
            )
            return (
              <article className="goal-card" key={goal.id}>
                <div className="goal-card-head">
                  <div className="goal-title">
                    <strong>{goal.name}</strong>
                    <span
                      className={`goal-status${
                        using
                          ? ' is-using'
                          : reached
                            ? ' is-reached'
                            : ' is-saving'
                      }`}
                    >
                      {using
                        ? '使用中'
                        : reached
                          ? '已达标'
                          : '攒钱中'}
                    </span>
                    {goal.goalProjectId ? (
                      <span className="goal-project-pill">
                        <FolderPlus size={12} />
                        {project?.name ?? '项目已删除'}
                      </span>
                    ) : null}
                  </div>
                  <div className="liability-item-actions">
                    <button
                      type="button"
                      className="row-action row-action--danger"
                      onClick={() => onCancel(goal.id)}
                      aria-label={`取消目标${goal.name}`}
                      title="取消目标"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                <div className="goal-progress-row">
                  <div className="goal-progress-copy">
                    <strong>
                      {formatMoney(summary.balanceCents / 100)}
                      <small>
                        {' '}
                        / {formatMoney(targetCentsValue / 100)}
                      </small>
                    </strong>
                    <span>
                      {using
                        ? `已使用 ${formatMoney(
                            usage.coveredCents / 100,
                          )} · 剩余 ${formatMoney(
                            summary.balanceCents / 100,
                          )}`
                        : reached
                          ? '目标金额已攒够'
                          : `还差 ${formatMoney(remainingCents / 100)}`}
                    </span>
                  </div>
                  <div className="goal-progress-meter" aria-hidden="true">
                    <span style={{ width: `${progress * 100}%` }} />
                  </div>
                  <span className="goal-progress-percent">
                    {Math.round(progress * 100)}%
                  </span>
                </div>

                <div className="goal-facts">
                  <div>
                    <span>目标日期</span>
                    <strong>
                      {goal.goalDate ? goal.goalDate : '未设置'}
                    </strong>
                  </div>
                  <div>
                    <span>建议每月</span>
                    <strong>
                      {plans[0]
                        ? formatMoney(plans[0].monthlyCents / 100)
                        : '—'}
                    </strong>
                  </div>
                  <div>
                    <span>预计达成</span>
                    <strong>
                      {plans[0] ? formatMonth(plans[0].finishMonth) : '—'}
                    </strong>
                  </div>
                  <div>
                    <span>项目已花</span>
                    <strong>
                      {using && goal.goalProjectId
                        ? formatMoney(usage.rawSpendCents / 100)
                        : '—'}
                    </strong>
                  </div>
                </div>

                {using && goal.goalProjectId ? (
                  <div className="goal-usage">
                    <span>
                      储蓄覆盖 {formatMoney(usage.coveredCents / 100)}
                    </span>
                    {usage.overageCents > 0 ? (
                      <span className="is-negative">
                        超出 {formatMoney(usage.overageCents / 100)}，由流动资金补足
                      </span>
                    ) : (
                      <span>项目支出从这笔储蓄里扣</span>
                    )}
                  </div>
                ) : null}

                {plans.length > 0 && !reached ? (
                  <p className="goal-recommendation">
                    {plans[0].detail}：每月存{' '}
                    {formatMoney(plans[0].monthlyCents / 100)}，约{' '}
                    {plans[0].months} 个月达成。
                  </p>
                ) : null}

                <div className="goal-actions">
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => openDeposit(goal)}
                  >
                    <PiggyBank size={14} />
                    存入
                  </button>
                  {!using && goal.goalProjectId ? (
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => onStart(goal.id)}
                    >
                      <Play size={14} />
                      开始使用
                    </button>
                  ) : null}
                  {!goal.goalProjectId ? (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() => openSettle(goal, usage)}
                    >
                      <CheckCircle2 size={14} />
                      结算并返还
                    </button>
                  ) : using ? (
                    <button
                      type="button"
                      className="button primary"
                      onClick={() => openSettle(goal, usage)}
                    >
                      <CheckCircle2 size={14} />
                      结束并结算
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => openEdit(goal)}
                  >
                    <Pencil size={14} />
                    编辑
                  </button>
                </div>

                {depositFor === goal.id ? (
                  <form
                    className="goal-inline-form"
                    onSubmit={(event) => handleDeposit(event, goal)}
                  >
                    <div className="goal-inline-form-title">
                      <strong>存入目标</strong>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setDepositFor(null)}
                        aria-label="关闭存入"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <div className="goal-inline-form-row">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={depositAmount}
                        onChange={(event) => {
                          setDepositAmount(sanitizeMoney(event.target.value))
                          setDepositError('')
                        }}
                        placeholder="金额"
                        aria-label="存入金额"
                      />
                      <input
                        type="date"
                        value={depositDate}
                        max={localDateKey()}
                        onChange={(event) =>
                          setDepositDate(event.target.value)
                        }
                        aria-label="存入日期"
                      />
                      <select
                        value={depositSource}
                        onChange={(event) =>
                          setDepositSource(
                            event.target.value as 'ledger' | 'external',
                          )
                        }
                        aria-label="资金来源"
                      >
                        <option value="ledger">从流动资金转入</option>
                        <option value="external">账外资金</option>
                      </select>
                      {depositSource === 'ledger' ? (
                        <select
                          value={depositAccount}
                          onChange={(event) =>
                            setDepositAccount(event.target.value)
                          }
                          aria-label="账户"
                        >
                          <option value="">不指定账户</option>
                          {accounts.map((account) => (
                            <option key={account.id} value={account.id}>
                              {account.name}
                            </option>
                          ))}
                        </select>
                      ) : null}
                      <input
                        type="text"
                        value={depositNote}
                        onChange={(event) => setDepositNote(event.target.value)}
                        placeholder="备注（选填）"
                        maxLength={200}
                        aria-label="存入备注"
                      />
                      <button type="submit" className="button secondary">
                        存入
                      </button>
                    </div>
                    {depositError ? (
                      <p className="form-error" role="alert">
                        {depositError}
                      </p>
                    ) : null}
                  </form>
                ) : null}

                {settleFor === goal.id ? (
                  <form
                    className="goal-inline-form"
                    onSubmit={(event) => handleSettle(event, goal)}
                  >
                    <div className="goal-inline-form-title">
                      <strong>结算目标</strong>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => setSettleFor(null)}
                        aria-label="关闭结算"
                      >
                        <X size={15} />
                      </button>
                    </div>
                    {goal.goalProjectId ? (
                      <div className="goal-settle-summary">
                        <span>
                          项目已花 {formatMoney(usage.rawSpendCents / 100)}，
                          储蓄覆盖 {formatMoney(usage.coveredCents / 100)}
                        </span>
                        <span>
                          剩余 {formatMoney(summary.balanceCents / 100)} 将返还流动资金
                        </span>
                        <p>
                          项目支出已经在流水里，结算时只写入储蓄划转；
                          项目设为「独立核算」时，这些支出不计入日常预算。
                        </p>
                      </div>
                    ) : (
                      <div className="goal-settle-fields">
                        <label className="field">
                          <span className="field-label">实际花掉</span>
                          <input
                            type="text"
                            inputMode="decimal"
                            value={spentInput}
                            onChange={(event) => {
                              setSpentInput(
                                sanitizeMoney(event.target.value),
                              )
                              setSettleError('')
                            }}
                          />
                        </label>
                        <label className="goal-checkbox">
                          <input
                            type="checkbox"
                            checked={writeToFlow}
                            onChange={(event) =>
                              setWriteToFlow(event.target.checked)
                            }
                          />
                          <span>写入流水（记为支出）</span>
                        </label>
                        {writeToFlow ? (
                          <>
                            <label className="field">
                              <span className="field-label">分类</span>
                              <select
                                value={settleCategory}
                                onChange={(event) =>
                                  setSettleCategory(event.target.value)
                                }
                              >
                                {categories
                                  .filter(
                                    (category) =>
                                      category.type === 'expense' &&
                                      !category.parentId,
                                  )
                                  .map((category) => (
                                    <option key={category.id} value={category.id}>
                                      {category.name}
                                    </option>
                                  ))}
                              </select>
                            </label>
                            <label className="field">
                              <span className="field-label">账户</span>
                              <select
                                value={settleAccount}
                                onChange={(event) =>
                                  setSettleAccount(event.target.value)
                                }
                              >
                                {accounts.map((account) => (
                                  <option key={account.id} value={account.id}>
                                    {account.name}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </>
                        ) : (
                          <p className="goal-hint">
                            不写入流水时，这笔支出只从目标储蓄里扣除，不会出现在收支统计中。
                          </p>
                        )}
                      </div>
                    )}
                    {!goal.goalProjectId ? (
                      <p className="goal-hint">
                        预计剩余{' '}
                        {formatMoney(
                          Math.max(
                            summary.balanceCents -
                              Math.min(
                                Math.max(
                                  Math.round(Number(spentInput) * 100) || 0,
                                  0,
                                ),
                                summary.balanceCents,
                              ),
                            0,
                          ) / 100,
                        )}{' '}
                        将返还流动资金
                      </p>
                    ) : null}
                    {settleError ? (
                      <p className="form-error" role="alert">
                        {settleError}
                      </p>
                    ) : null}
                    <div className="goal-inline-form-actions">
                      <button
                        type="button"
                        className="button ghost"
                        onClick={() => setSettleFor(null)}
                      >
                        取消
                      </button>
                      <button type="submit" className="button primary">
                        确认结算
                      </button>
                    </div>
                  </form>
                ) : null}

                <details className="goal-history">
                  <summary>
                    资金记录
                    <span>{entries.length}</span>
                  </summary>
                  {entries.length > 0 ? (
                    <ul>
                      {entries.map((entry) => {
                        const signed =
                          entry.kind === 'withdraw' ? -entry.amountCents : entry.amountCents
                        return (
                          <li key={entry.id}>
                            <span>{formatShortDate(entry.date)}</span>
                            <span>
                              {entry.note ||
                                (entry.kind === 'deposit'
                                  ? entry.source === 'ledger'
                                    ? '从流动资金存入'
                                    : '账外存入'
                                  : entry.kind === 'withdraw'
                                    ? '转回流动资金'
                                    : '余额调整')}
                            </span>
                            <strong className={signed < 0 ? 'is-negative' : ''}>
                              {signed < 0 ? '−' : '+'}
                              {formatMoney(Math.abs(signed) / 100)}
                            </strong>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <p>还没有存入记录。</p>
                  )}
                </details>
              </article>
            )
          })}
        </div>
      ) : null}

      {closedGoals.length > 0 ? (
        <details className="goal-closed">
          <summary>
            <ChevronDown size={14} />
            已结束的目标
            <span>{closedGoals.length}</span>
          </summary>
          <div className="goal-list goal-list--closed">
            {closedGoals.map((goal) => {
              return (
                <div className="goal-closed-row" key={goal.id}>
                  <div>
                    <strong>{goal.name}</strong>
                    <span>
                      {goal.goalSettledAt
                        ? `结算于 ${formatShortDate(goal.goalSettledAt)}`
                        : '已关闭'}
                    </span>
                  </div>
                  <span>
                    目标 {formatMoney((goal.goalTargetCents ?? 0) / 100)}
                  </span>
                  <span>已关闭</span>
                  <button
                    type="button"
                    className="row-action row-action--danger"
                    onClick={() => onDelete(goal.id)}
                    aria-label="删除已结束目标"
                    title="删除记录"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        </details>
      ) : null}
    </div>
  )
}
