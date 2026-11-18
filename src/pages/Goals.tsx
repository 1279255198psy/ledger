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
import { DateInput } from '../components/DateInput'
import { Modal } from '../components/Modal'
import { SelectMenu } from '../components/SelectMenu'
import { buildGoalPlans } from '../lib/goalPlans'
import type { GoalPlanContext } from '../lib/goalPlans'
import {
  formatMoney,
  formatShortDate,
  localDateKey,
  shiftMonth,
} from '../lib/utils'
import type {
  Account,
  Category,
  LedgerTransaction,
  Project,
  ProjectDraft,
  GoalPlan,
  GoalPlanKey,
  SavingsEntryDraft,
  SavingsGoalDraft,
  SavingsGoalPlanDraft,
  SavingsGoalUpdateDraft,
  SavingsHolding,
} from '../types'

interface GoalsProps {
  goals: SavingsHolding[]
  projects: Project[]
  accounts: Account[]
  categories: Category[]
  transactions: LedgerTransaction[]
  goalPlanContext: GoalPlanContext
  onCreate: (draft: SavingsGoalDraft) => void
  onUpdate: (id: string, draft: SavingsGoalUpdateDraft) => void
  onApplyPlan: (id: string, plan: SavingsGoalPlanDraft) => void
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
  startDate: string
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
  goalPlanContext,
  onCreate,
  onUpdate,
  onApplyPlan,
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
  const [planMonthly, setPlanMonthly] = useState('')
  const [planMode, setPlanMode] = useState<GoalPlanKey>('balanced')
  const [projectFormOpen, setProjectFormOpen] = useState(false)
  const [projectDraft, setProjectDraft] = useState<ProjectDraftState>({
    name: '',
    startDate: '',
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
  const editorUsage = editorHolding
    ? getGoalUsage(editorHolding, transactions, today)
    : { rawSpendCents: 0, coveredCents: 0, overageCents: 0 }
  const initialCents =
    editor?.mode === 'create'
      ? Math.max(Math.round(Number(initial) * 100) || 0, 0)
      : 0
  const fundedCents =
    currentBalance +
    initialCents +
    (editorHolding?.goalStatus === 'using' ? editorUsage.coveredCents : 0)
  const remaining =
    Number.isFinite(targetCents) && targetCents > fundedCents
      ? targetCents - fundedCents
      : 0
  const monthlyCommitmentCents = (goal: SavingsHolding): number => {
    if (
      goal.closedAt ||
      goal.goalStatus === 'settled' ||
      !goal.goalMonthlyCents
    ) {
      return 0
    }
    const summary = getSavingsSummary(goal, today, transactions)
    const usage = getGoalUsage(goal, transactions, today)
    const funded =
      summary.balanceCents +
      (goal.goalStatus === 'using' ? usage.coveredCents : 0)
    return funded >= (goal.goalTargetCents ?? 0)
      ? 0
      : goal.goalMonthlyCents
  }
  const committedMonthlyCents = activeGoals
    .filter((goal) => goal.id !== editor?.id)
    .reduce((sum, goal) => sum + monthlyCommitmentCents(goal), 0)
  const averageSurplusCents = Math.max(
    goalPlanContext.averageIncomeCents -
      goalPlanContext.averageExpenseCents,
    0,
  )
  const freeMonthlyCents = Math.max(
    averageSurplusCents -
      goalPlanContext.monthlyDebtCents -
      committedMonthlyCents,
    0,
  )
  const plans = buildGoalPlans(
    remaining,
    goalPlanContext,
    targetDate || undefined,
    committedMonthlyCents,
    today,
  )

  const balancedPlan = plans.find((plan) => plan.key === 'balanced')
  const deadlinePlan = plans.find((plan) => plan.key === 'deadline')
  const steadyPlan = plans.find((plan) => plan.key === 'steady')
  const fastPlan = plans.find((plan) => plan.key === 'fast')
  const otherCommittedGoals = activeGoals.filter(
    (goal) => goal.id !== editor?.id && monthlyCommitmentCents(goal) > 0,
  )

  const planToDraft = (plan: GoalPlan): SavingsGoalPlanDraft => ({
    monthlyCents: plan.monthlyCents,
    label: plan.label,
    finishMonth: plan.finishMonth,
    source: 'recommended',
    key: plan.key,
  })

  const planMonthlyCents = Math.round(Number(planMonthly) * 100)
  const planMonths =
    planMonthlyCents > 0 && remaining > 0
      ? Math.max(remaining / planMonthlyCents, 0.1)
      : 0
  const planFinishMonth =
    planMonths > 0
      ? shiftMonth(today.slice(0, 7), Math.ceil(planMonths))
      : ''
  const planOverCapacity =
    planMonthlyCents > 0 && planMonthlyCents > freeMonthlyCents
  const planLate =
    Boolean(targetDate && planFinishMonth) &&
    planFinishMonth > targetDate.slice(0, 7)
  const planModeLabel: Record<GoalPlanKey, string> = {
    deadline: '按目标日',
    balanced: '按能力',
    steady: '轻松',
    fast: '加速',
    custom: '自定义',
  }
  const planDraft: SavingsGoalPlanDraft | undefined =
    planMonthlyCents > 0 && planMonths > 0
      ? {
          monthlyCents: planMonthlyCents,
          label: planModeLabel[planMode],
          finishMonth: planFinishMonth,
          source: planMode === 'custom' ? 'custom' : 'recommended',
          key: planMode,
        }
      : undefined

  const selectPlan = (plan: GoalPlan) => {
    setPlanMode(plan.key)
    setPlanMonthly(centsToInput(plan.monthlyCents))
    setFormError('')
  }

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
    setPlanMonthly('')
    setPlanMode('balanced')
    setProjectFormOpen(false)
    setProjectDraft({ name: '', startDate: '', budget: '' })
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
    setPlanMonthly(
      goal.goalMonthlyCents ? centsToInput(goal.goalMonthlyCents) : '',
    )
    setPlanMode(goal.goalPlanKey ?? 'custom')
  }

  const closeEditor = () => {
    setEditor(null)
    setFormError('')
    setPlanMonthly('')
    setPlanMode('balanced')
    setProjectFormOpen(false)
  }

  const handleProjectSelect = (nextId: string) => {
    setProjectId(nextId)
    const project = projects.find((item) => item.id === nextId)
    if (project?.budgetCents && !target.trim()) {
      setTarget(centsToInput(project.budgetCents))
      setPlanMonthly('')
      setPlanMode('balanced')
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
      startDate: projectDraft.startDate || today,
      ...(budgetCents && budgetCents > 0 ? { budgetCents } : {}),
    })
    setProjectId(id)
    if (budgetCents && budgetCents > 0 && !target.trim()) {
      setTarget(centsToInput(budgetCents))
      setPlanMonthly('')
      setPlanMode('balanced')
    }
    setProjectFormOpen(false)
    setProjectDraft({ name: '', startDate: '', budget: '' })
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
        ...(planDraft ? { plan: planDraft } : {}),
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
      ...(planDraft ? { plan: planDraft } : {}),
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
        <Modal
          open
          onClose={closeEditor}
          labelledBy="goal-editor-title"
          className="goal-editor-modal"
        >
        <form className="liability-editor goal-editor" onSubmit={handleSubmit}>
          <div className="liability-editor-head">
            <strong id="goal-editor-title">
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

          <section className="goal-form-section goal-form-main">
            <div className="goal-form-section-head">
              <div>
                <h4>目标</h4>
                <p>攒什么、攒到多少，以及希望什么时候用。</p>
              </div>
            </div>
            <div className="goal-form-grid">
            <label className="field goal-field-full">
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
                  setPlanMonthly('')
      setPlanMode('balanced')
                  setFormError('')
                }}
                placeholder="0.00"
              />
            </label>
            <label className="field">
              <span className="field-label">
                目标日期 <span className="optional">选填</span>
              </span>
              <DateInput
                value={targetDate}
                min={today}
                ariaLabel="目标日期"
                onChange={(next) => {
                  setTargetDate(next)
                  setPlanMonthly('')
      setPlanMode('balanced')
                  setFormError('')
                }}
              />
            </label>
            <div className="field goal-field-full">
              <span className="field-label">
                关联项目 <span className="optional">选填</span>
              </span>
              <SelectMenu
                value={projectId}
                options={goalProjects.map((project) => ({
                  value: project.id,
                  label: project.name,
                }))}
                onChange={handleProjectSelect}
                ariaLabel="关联项目"
                allLabel="不关联项目"
                disabled={editorHolding?.goalStatus === 'using'}
                elevated
              />
            </div>
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
                    startDate: targetDate || today,
                    budget: target,
                  })
                }}
              >
                <FolderPlus size={14} />
                没有合适的项目？直接新建
              </button>
            ) : (
              <div
                className="goal-project-form"
                onKeyDown={(event) => {
                  if (event.key !== 'Enter') return
                  event.preventDefault()
                  handleProjectCreate()
                }}
              >
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
                    <span className="field-label">起始日期</span>
                    <DateInput
                      value={projectDraft.startDate}
                      ariaLabel="项目起始日期"
                      onChange={(next) =>
                        setProjectDraft((current) => ({
                          ...current,
                          startDate: next,
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
                  <button
                    type="button"
                    className="button secondary"
                    onClick={handleProjectCreate}
                  >
                    创建并选中
                  </button>
                </div>
              </div>
            )}
          </div>
          </section>

          {editor.mode === 'create' ? (
            <section className="goal-form-section goal-form-main">
              <div className="goal-form-section-head">
                <div>
                  <h4>初始资金</h4>
                  <p>先把已经存进去的钱记上；没有也可以从零开始。</p>
                </div>
              </div>
              <div className="goal-form-grid goal-form-grid--3">
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
              <div className="field">
                <span className="field-label">资金来源</span>
                <SelectMenu
                  value={source}
                  options={[
                    { value: 'ledger', label: '从流动资金转入' },
                    { value: 'external', label: '账外已有资金' },
                  ]}
                  onChange={(next) =>
                    setSource(next as 'ledger' | 'external')
                  }
                  ariaLabel="目标资金来源"
                  elevated
                />
              </div>
              {source === 'ledger' ? (
                <div className="field">
                  <span className="field-label">账户</span>
                  <SelectMenu
                    value={accountId}
                    options={accounts.map((account) => ({
                      value: account.id,
                      label: account.name,
                    }))}
                    onChange={setAccountId}
                    ariaLabel="目标账户"
                    allLabel="不指定"
                    elevated
                  />
                </div>
              ) : null}
            </div>
            </section>
          ) : null}

          <section className="budget-block goal-plan-block goal-form-side">
            <div className="budget-block-head">
              <div>
                <h4>储蓄计划</h4>
                <p>
                  先看每月能安排多少，再选择节奏；计划会随目标一起保存。
                </p>
              </div>
            </div>

            <p className="goal-plan-task-line">
              {targetCents > 0 ? (
                <>
                  目标 {formatMoney(targetCents / 100)} · 已存{' '}
                  {formatMoney(fundedCents / 100)} · 还差{' '}
                  {formatMoney(remaining / 100)}
                </>
              ) : (
                '填写目标金额后，这里会显示任务量和计划。'
              )}
            </p>

            <div className="goal-plan-facts">
              <div>
                <span>每月可安排</span>
                <strong>{formatMoney(freeMonthlyCents / 100)}</strong>
                <small>已扣除还款与其他目标</small>
              </div>
              <div>
                <span>其他目标占用</span>
                <strong>{formatMoney(committedMonthlyCents / 100)}</strong>
                <small>{otherCommittedGoals.length} 个已定计划目标</small>
              </div>
              <div>
                <span>目标日所需</span>
                <strong>
                  {deadlinePlan
                    ? formatMoney(deadlinePlan.monthlyCents / 100)
                    : '—'}
                </strong>
                <small>{targetDate ? `截至 ${targetDate}` : '未设置目标日'}</small>
              </div>
              <div>
                <span>
                  {goalPlanContext.monthCount > 0
                    ? `近 ${goalPlanContext.monthCount} 月平均结余`
                    : '平均结余'}
                </span>
                <strong>{formatMoney(averageSurplusCents / 100)}</strong>
                <small>
                  每月还款 {formatMoney(goalPlanContext.monthlyDebtCents / 100)}
                </small>
              </div>
            </div>

            {targetCents > 0 && remaining > 0 ? (
              <>
                <div
                  className="goal-plan-modes"
                  role="group"
                  aria-label="计划方式"
                >
                  {[
                    {
                      key: 'balanced' as const,
                      label: '按能力',
                      plan: balancedPlan,
                    },
                    {
                      key: 'deadline' as const,
                      label: '按目标日',
                      plan: deadlinePlan,
                    },
                    { key: 'steady' as const, label: '轻松', plan: steadyPlan },
                    { key: 'fast' as const, label: '加速', plan: fastPlan },
                  ]
                    .filter((item) => item.plan)
                    .map(({ key, label, plan }) => (
                      <button
                        key={key}
                        type="button"
                        className={
                          planMode === key &&
                          plan?.monthlyCents === planMonthlyCents
                            ? 'is-active'
                            : ''
                        }
                        onClick={() => plan && selectPlan(plan)}
                      >
                        <span>{label}</span>
                        <strong>
                          {plan ? formatMoney(plan.monthlyCents / 100) : '—'}
                        </strong>
                        <small>
                          {plan ? `约 ${plan.months.toFixed(1)} 个月` : ''}
                        </small>
                        {plan && !plan.feasible ? (
                          <em>超出能力</em>
                        ) : null}
                      </button>
                    ))}
                </div>

                <div className="goal-plan-input-row">
                  <label className="goal-plan-amount">
                    <span>每月存入</span>
                    <div className="budget-input">
                      <span>¥</span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={planMonthly}
                        onChange={(event) => {
                          setPlanMonthly(sanitizeMoney(event.target.value))
                          setPlanMode('custom')
                          setFormError('')
                        }}
                        placeholder="0.00"
                        aria-label="每月储蓄金额"
                      />
                    </div>
                  </label>
                  <div className="goal-plan-preview">
                    {planMonthlyCents > 0 ? (
                      <>
                        <span>
                          按每月 {formatMoney(planMonthlyCents / 100)} 计算
                        </span>
                        <strong>
                          {planMonths > 0
                            ? `约 ${planMonths.toFixed(
                                1,
                              )} 个月 · ${formatMonth(planFinishMonth)}`
                            : '目标已达成'}
                        </strong>
                        <p
                          className={
                            planOverCapacity || planLate ? 'is-warning' : ''
                          }
                        >
                          {planOverCapacity
                            ? `超过每月可安排 ${formatMoney(
                                freeMonthlyCents / 100,
                              )}，建议降低金额或延长时间。`
                            : planLate
                              ? `比目标日晚一些，按当前速度会在 ${formatMonth(
                                  planFinishMonth,
                                )}达成。`
                              : freeMonthlyCents > 0
                                ? `占每月可安排结余的 ${Math.round(
                                    (planMonthlyCents / freeMonthlyCents) * 100,
                                  )}%。`
                                : '先增加每月可安排的结余。'}
                        </p>
                      </>
                    ) : plans.length > 0 ? (
                      <span>选择一个方案，或填入每月能存的钱。</span>
                    ) : (
                      <span>
                        当前没有可安排的结余，可以直接填一个每月金额，或把目标日期往后放。
                      </span>
                    )}
                  </div>
                </div>

                {plans.find((plan) => plan.key === planMode)?.warning ? (
                  <p className="goal-plan-warning">
                    {plans.find((plan) => plan.key === planMode)?.warning}
                  </p>
                ) : null}

                {otherCommittedGoals.length > 0 ? (
                  <details className="goal-other-goals">
                    <summary>
                      其他目标每月占用{' '}
                      {formatMoney(committedMonthlyCents / 100)}
                    </summary>
                    <ul>
                      {otherCommittedGoals.map((other) => (
                        <li key={other.id}>
                          <span>{other.name}</span>
                          <strong>
                            {formatMoney(
                              monthlyCommitmentCents(other) / 100,
                            )}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </>
            ) : (
              <p className="budget-mode-note">
                {targetCents > 0
                  ? '目标金额已经攒够，不需要新的储蓄计划。'
                  : '先填写目标金额，计划会在下面出现。'}
              </p>
            )}
          </section>

          <section className="goal-form-section goal-form-main">
            <div className="goal-form-section-head">
              <div>
                <h4>备注</h4>
                <p>写一句为什么攒这笔钱，或者达成后的打算。</p>
              </div>
            </div>
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
          </section>

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
        </Modal>
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
            const committedForGoal = activeGoals
              .filter((item) => item.id !== goal.id)
              .reduce(
                (sum, item) => sum + monthlyCommitmentCents(item),
                0,
              )
            const plans = buildGoalPlans(
              remainingCents,
              goalPlanContext,
              goal.goalDate ?? undefined,
              committedForGoal,
              today,
            )
            const recommendedPlan =
              plans.find(
                (plan) => plan.key === 'deadline' && plan.feasible,
              ) ??
              plans.find(
                (plan) => plan.key === 'balanced' && plan.feasible,
              ) ??
              plans.find((plan) => plan.feasible) ??
              plans[0]
            const appliedPlanDraft: SavingsGoalPlanDraft | null =
              goal.goalMonthlyCents
                ? {
                    monthlyCents: goal.goalMonthlyCents,
                    label: goal.goalPlanLabel ?? '自定义',
                    finishMonth: goal.goalPlanFinishMonth ?? '',
                    source: goal.goalPlanSource ?? 'custom',
                    key: goal.goalPlanKey ?? 'custom',
                  }
                : null
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
                    {appliedPlanDraft ? (
                      <span className="goal-plan-badge">已定计划</span>
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
                    <span>
                      {appliedPlanDraft ? '计划每月' : '建议每月'}
                    </span>
                    <strong>
                      {appliedPlanDraft
                        ? formatMoney(appliedPlanDraft.monthlyCents / 100)
                        : recommendedPlan
                          ? formatMoney(recommendedPlan.monthlyCents / 100)
                          : '—'}
                    </strong>
                  </div>
                  <div>
                    <span>
                      {appliedPlanDraft ? '计划达成' : '预计达成'}
                    </span>
                    <strong>
                      {appliedPlanDraft
                        ? appliedPlanDraft.finishMonth
                          ? formatMonth(appliedPlanDraft.finishMonth)
                          : '—'
                        : recommendedPlan
                          ? formatMonth(recommendedPlan.finishMonth)
                          : '—'}
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

                {appliedPlanDraft ? (
                  <div className="goal-recommendation goal-recommendation--applied">
                    <span>
                      <CheckCircle2 size={13} />
                      已应用「{appliedPlanDraft.label}」计划：每月{' '}
                      {formatMoney(appliedPlanDraft.monthlyCents / 100)}
                    </span>
                    <button
                      type="button"
                      className="goal-text-action"
                      onClick={() => openEdit(goal)}
                    >
                      重新计划
                    </button>
                  </div>
                ) : plans.length > 0 && !reached ? (
                  <div className="goal-recommendation-row">
                    <p className="goal-recommendation">
                      {recommendedPlan.detail}
                    </p>
                    <button
                      type="button"
                      className="button ghost goal-apply-plan"
                      onClick={() => onApplyPlan(goal.id, planToDraft(recommendedPlan))}
                    >
                      应用推荐
                    </button>
                  </div>
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
                      <DateInput
                        value={depositDate}
                        max={localDateKey()}
                        ariaLabel="存入日期"
                        onChange={setDepositDate}
                      />
                      <SelectMenu
                        value={depositSource}
                        options={[
                          { value: 'ledger', label: '从流动资金转入' },
                          { value: 'external', label: '账外资金' },
                        ]}
                        onChange={(next) =>
                          setDepositSource(next as 'ledger' | 'external')
                        }
                        ariaLabel="存入资金来源"
                      />
                      {depositSource === 'ledger' ? (
                        <SelectMenu
                          value={depositAccount}
                          options={accounts.map((account) => ({
                            value: account.id,
                            label: account.name,
                          }))}
                          onChange={setDepositAccount}
                          ariaLabel="存入账户"
                          allLabel="不指定账户"
                        />
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
                            <div className="field">
                              <span className="field-label">分类</span>
                              <SelectMenu
                                value={settleCategory}
                                options={categories
                                  .filter(
                                    (category) =>
                                      category.type === 'expense' &&
                                      !category.parentId,
                                  )
                                  .map((category) => ({
                                    value: category.id,
                                    label: category.name,
                                  }))}
                                onChange={setSettleCategory}
                                ariaLabel="结算支出分类"
                              />
                            </div>
                            <div className="field">
                              <span className="field-label">账户</span>
                              <SelectMenu
                                value={settleAccount}
                                options={accounts.map((account) => ({
                                  value: account.id,
                                  label: account.name,
                                }))}
                                onChange={setSettleAccount}
                                ariaLabel="结算账户"
                              />
                            </div>
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
