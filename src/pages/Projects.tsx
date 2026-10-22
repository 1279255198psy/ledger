import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Archive,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  FolderPlus,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { CategoryIcon } from '../components/CategoryIcon'
import { TransactionRow } from '../components/TransactionRow'
import { getTopLevelCategories } from '../lib/categories'
import {
  getProjectCategoryCents,
  getProjectSummary,
} from '../lib/allocations'
import {
  currentMonthKey,
  daysInMonthOfKey,
  formatMoney,
  formatPercent,
  localDateKey,
  monthLabel,
  monthOfDateKey,
  shiftMonth,
} from '../lib/utils'
import type {
  LedgerTransaction,
  Project,
  ProjectDraft,
  ProjectSummary,
} from '../types'

interface ProjectsProps {
  transactions: LedgerTransaction[]
  projects: Project[]
  onCreateProject: (draft: ProjectDraft) => string
  onUpdateProject: (id: string, draft: ProjectDraft) => void
  onToggleProjectStatus: (id: string) => void
  onToggleProjectArchive: (id: string) => void
  onDeleteProject: (id: string) => void
  onAddTransaction: (projectId: string) => void
  onEditTransaction: (transaction: LedgerTransaction) => void
  onDeleteTransaction: (id: string) => void
}

type ProjectFilter = 'active' | 'closed' | 'archived' | 'all'
type EditorMode = 'create' | 'edit' | null
type PickerTarget = 'start' | 'end'
type ProjectPhase = 'active' | 'closed' | 'expired' | 'archived'

interface ProjectFormState {
  name: string
  startDate: string
  endDate: string
  budget: string
  note: string
  categoryBudgets: Record<string, string>
}

interface CalendarDay {
  key: string
  day: number
  inMonth: boolean
  isToday: boolean
}

interface ProjectStat {
  summary: ProjectSummary
  count: number
  categoryCents: Map<string, number>
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
const FILTERS: Array<{ id: ProjectFilter; label: string }> = [
  { id: 'active', label: '进行中' },
  { id: 'closed', label: '已结束' },
  { id: 'archived', label: '已归档' },
  { id: 'all', label: '全部' },
]
const PROJECT_TONES = ['forest', 'clay', 'sky', 'amber', 'plum', 'teal']

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function buildCalendar(monthKey: string): CalendarDay[] {
  const [year, month] = monthKey.split('-').map(Number)
  const first = new Date(year, month - 1, 1)
  const totalDays = daysInMonthOfKey(monthKey)
  const cellCount = Math.ceil((first.getDay() + totalDays) / 7) * 7
  const start = new Date(year, month - 1, 1 - first.getDay())
  const today = localDateKey()

  return Array.from({ length: cellCount }, (_, index) => {
    const date = new Date(
      start.getFullYear(),
      start.getMonth(),
      start.getDate() + index,
    )
    const key = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    return {
      key,
      day: date.getDate(),
      inMonth: date.getMonth() === month - 1,
      isToday: key === today,
    }
  })
}

function projectTone(id: string): string {
  let total = 0
  for (let index = 0; index < id.length; index += 1) {
    total = (total + id.charCodeAt(index)) % 997
  }
  return PROJECT_TONES[total % PROJECT_TONES.length]
}

function projectLastDate(project: Project): string {
  if (project.endDate) return project.endDate
  if (project.archivedAt) return project.archivedAt.slice(0, 10)
  if (project.status === 'closed') return project.updatedAt.slice(0, 10)
  return '9999-12-31'
}

function projectCoversDate(project: Project, dateKey: string): boolean {
  return dateKey >= project.startDate && dateKey <= projectLastDate(project)
}

function projectPhase(project: Project, today: string): ProjectPhase {
  if (project.archivedAt) return 'archived'
  if (project.status === 'closed') return 'closed'
  if (project.endDate && project.endDate < today) return 'expired'
  return 'active'
}

function phaseLabel(phase: ProjectPhase): string {
  if (phase === 'archived') return '已归档'
  if (phase === 'closed') return '已结束'
  if (phase === 'expired') return '已到期'
  return '进行中'
}

function formatProjectRange(project: Project): string {
  const end =
    project.endDate ??
    (project.archivedAt
      ? project.archivedAt.slice(0, 10)
      : project.status === 'active'
        ? '长期'
        : project.updatedAt.slice(0, 10))
  return `${project.startDate} → ${end}`
}

function centsToInput(cents: number): string {
  return (cents / 100)
    .toFixed(2)
    .replace(/\.00$/, '')
    .replace(/(\.\d)0$/, '$1')
}

function parseCents(value: string): number | null {
  if (!value.trim()) return null
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) return null
  return Math.round(amount * 100)
}

function emptyForm(startDate = localDateKey()): ProjectFormState {
  const categoryBudgets: Record<string, string> = {}
  for (const category of getTopLevelCategories('expense')) {
    categoryBudgets[category.id] = ''
  }
  return {
    name: '',
    startDate,
    endDate: '',
    budget: '',
    note: '',
    categoryBudgets,
  }
}

function formFromProject(project: Project): ProjectFormState {
  const categoryBudgets: Record<string, string> = {}
  for (const category of getTopLevelCategories('expense')) {
    const cents = project.categoryBudgetsCents?.[category.id]
    categoryBudgets[category.id] = cents ? centsToInput(cents) : ''
  }
  return {
    name: project.name,
    startDate: project.startDate,
    endDate: project.endDate ?? '',
    budget: project.budgetCents ? centsToInput(project.budgetCents) : '',
    note: project.note ?? '',
    categoryBudgets,
  }
}

function sortProjects(left: Project, right: Project): number {
  const archived =
    Number(Boolean(left.archivedAt)) - Number(Boolean(right.archivedAt))
  if (archived !== 0) return archived
  const status =
    Number(left.status === 'closed') - Number(right.status === 'closed')
  if (status !== 0) return status
  return right.updatedAt.localeCompare(left.updatedAt)
}

export function Projects({
  transactions,
  projects,
  onCreateProject,
  onUpdateProject,
  onToggleProjectStatus,
  onToggleProjectArchive,
  onDeleteProject,
  onAddTransaction,
  onEditTransaction,
  onDeleteTransaction,
}: ProjectsProps) {
  const today = localDateKey()
  const [calendarMonth, setCalendarMonth] = useState(() => currentMonthKey())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState<ProjectFilter>('active')
  const [editorMode, setEditorMode] = useState<EditorMode>(null)
  const [draft, setDraft] = useState<ProjectFormState>(() => emptyForm())
  const [pickerTarget, setPickerTarget] = useState<PickerTarget>('start')
  const [formError, setFormError] = useState('')

  const projectStats = useMemo(() => {
    const stats = new Map<string, ProjectStat>()
    for (const project of projects) {
      stats.set(project.id, {
        summary: getProjectSummary(transactions, project.id),
        count: transactions.filter((transaction) =>
          transaction.allocations.some(
            (line) =>
              line.targetType === 'project' &&
              line.projectId === project.id,
          ),
        ).length,
        categoryCents: getProjectCategoryCents(transactions, project.id),
      })
    }
    return stats
  }, [projects, transactions])

  const sortedProjects = useMemo(
    () => [...projects].sort(sortProjects),
    [projects],
  )

  const filteredProjects = useMemo(
    () =>
      sortedProjects.filter((project) => {
        if (filter === 'all') return true
        if (filter === 'archived') return Boolean(project.archivedAt)
        return !project.archivedAt && project.status === filter
      }),
    [filter, sortedProjects],
  )

  const filterCounts = useMemo(
    () => ({
      active: projects.filter(
        (project) => !project.archivedAt && project.status === 'active',
      ).length,
      closed: projects.filter(
        (project) => !project.archivedAt && project.status === 'closed',
      ).length,
      archived: projects.filter((project) => Boolean(project.archivedAt))
        .length,
      all: projects.length,
    }),
    [projects],
  )

  const selectedProject =
    projects.find((project) => project.id === selectedId) ?? null

  const projectTransactions = useMemo(() => {
    if (!selectedId) return []
    return transactions.filter((transaction) =>
      transaction.allocations.some(
        (line) =>
          line.targetType === 'project' && line.projectId === selectedId,
      ),
    )
  }, [selectedId, transactions])

  const calendarDays = useMemo(
    () => buildCalendar(calendarMonth),
    [calendarMonth],
  )

  const monthDays = calendarDays.filter((day) => day.inMonth)
  const monthStart = monthDays[0]?.key ?? `${calendarMonth}-01`
  const monthEnd =
    monthDays[monthDays.length - 1]?.key ??
    `${calendarMonth}-${pad(daysInMonthOfKey(calendarMonth))}`

  const legendProjects = filteredProjects.filter(
    (project) =>
      project.startDate <= monthEnd && projectLastDate(project) >= monthStart,
  )

  const rangeStart = editorMode
    ? draft.startDate
    : (selectedProject?.startDate ?? '')
  const rangeEnd = editorMode
    ? draft.endDate
    : (selectedProject?.endDate ?? '')

  const categoryBudgetTotal = getTopLevelCategories('expense').reduce(
    (total, category) => {
      const cents = parseCents(draft.categoryBudgets[category.id] ?? '')
      return total + (cents ?? 0)
    },
    0,
  )

  const budgetCents = parseCents(draft.budget)

  useEffect(() => {
    if (editorMode) return
    if (selectedId && projects.some((project) => project.id === selectedId)) {
      return
    }
    const first =
      projects.find(
        (project) => !project.archivedAt && project.status === 'active',
      ) ??
      projects.find((project) => !project.archivedAt) ??
      projects[0]
    setSelectedId(first?.id ?? null)
  }, [editorMode, projects, selectedId])

  const selectProject = (project: Project) => {
    setSelectedId(project.id)
    setEditorMode(null)
    setFormError('')
    setCalendarMonth(monthOfDateKey(project.startDate))
  }

  const startCreate = (startDate?: string) => {
    setSelectedId(null)
    setEditorMode('create')
    setDraft(emptyForm(startDate ?? localDateKey()))
    setPickerTarget(startDate ? 'end' : 'start')
    setFormError('')
  }

  const startEdit = (project: Project) => {
    setSelectedId(project.id)
    setEditorMode('edit')
    setDraft(formFromProject(project))
    setPickerTarget('start')
    setFormError('')
    setCalendarMonth(monthOfDateKey(project.startDate))
  }

  const handleDayClick = (day: CalendarDay) => {
    if (editorMode) {
      if (pickerTarget === 'start') {
        setDraft((current) => ({
          ...current,
          startDate: day.key,
          endDate:
            current.endDate && current.endDate < day.key
              ? ''
              : current.endDate,
        }))
        setPickerTarget('end')
      } else if (day.key < draft.startDate) {
        setDraft((current) => ({
          ...current,
          startDate: day.key,
          endDate: '',
        }))
      } else {
        setDraft((current) => ({ ...current, endDate: day.key }))
      }
      setFormError('')
      return
    }

    const dayProjects = filteredProjects.filter((project) =>
      projectCoversDate(project, day.key),
    )
    if (dayProjects.length > 0) {
      selectProject(
        dayProjects.find((project) => project.id === selectedId) ??
          dayProjects[0],
      )
      return
    }
    startCreate(day.key)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    const name = draft.name.trim()
    if (!name) {
      setFormError('请给项目起一个名字')
      return
    }
    if (!draft.startDate) {
      setFormError('请选择项目开始日期')
      return
    }
    if (draft.endDate && draft.endDate < draft.startDate) {
      setFormError('截止日期不能早于开始日期')
      return
    }

    const nextBudgetCents = parseCents(draft.budget)
    if (draft.budget.trim() && nextBudgetCents === null) {
      setFormError('项目预算需要是大于等于 0 的金额')
      return
    }

    const categoryBudgetsCents: Record<string, number> = {}
    for (const category of getTopLevelCategories('expense')) {
      const raw = draft.categoryBudgets[category.id] ?? ''
      if (!raw.trim()) continue
      const cents = parseCents(raw)
      if (cents === null) {
        setFormError(`「${category.name}」的预算需要是大于等于 0 的金额`)
        return
      }
      if (cents > 0) categoryBudgetsCents[category.id] = cents
    }

    const payload: ProjectDraft = {
      name,
      startDate: draft.startDate,
      ...(draft.endDate ? { endDate: draft.endDate } : {}),
      ...(nextBudgetCents !== null && nextBudgetCents > 0
        ? { budgetCents: nextBudgetCents }
        : {}),
      ...(Object.keys(categoryBudgetsCents).length > 0
        ? { categoryBudgetsCents }
        : {}),
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    }

    if (editorMode === 'edit' && selectedProject) {
      onUpdateProject(selectedProject.id, payload)
    } else {
      const id = onCreateProject(payload)
      setSelectedId(id)
      setFilter('active')
    }
    setCalendarMonth(monthOfDateKey(draft.startDate))
    setEditorMode(null)
    setFormError('')
  }

  const renderEditor = () => (
    <form className="project-editor" onSubmit={handleSubmit}>
      <div className="project-editor-head">
        <div>
          <p className="card-kicker">
            {editorMode === 'edit' ? 'EDIT PROJECT' : 'NEW PROJECT'}
          </p>
          <h2>{editorMode === 'edit' ? '编辑项目' : '新建项目'}</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={() => setEditorMode(null)}
          aria-label="关闭项目编辑"
        >
          <X size={17} />
        </button>
      </div>

      <p className="project-editor-hint">
        在左侧日历点选日期，填入当前选中的开始或截止日期。截止日期可以留空，
        项目会一直进行到手动结束。
      </p>

      <div className="project-date-targets" role="group" aria-label="选择要填入的日期">
        <button
          type="button"
          className={pickerTarget === 'start' ? 'is-active' : ''}
          onClick={() => setPickerTarget('start')}
          aria-pressed={pickerTarget === 'start'}
        >
          <span>开始日期</span>
          <strong>{draft.startDate || '点选日期'}</strong>
        </button>
        <button
          type="button"
          className={pickerTarget === 'end' ? 'is-active' : ''}
          onClick={() => setPickerTarget('end')}
          aria-pressed={pickerTarget === 'end'}
        >
          <span>截止日期</span>
          <strong>{draft.endDate || '不设截止'}</strong>
        </button>
        {draft.endDate ? (
          <button
            type="button"
            className="project-date-clear"
            onClick={() => setDraft((current) => ({ ...current, endDate: '' }))}
          >
            清除截止
          </button>
        ) : null}
      </div>

      <label className="field">
        <span className="field-label">项目名称</span>
        <input
          type="text"
          value={draft.name}
          onChange={(event) => {
            setDraft((current) => ({ ...current, name: event.target.value }))
            setFormError('')
          }}
          placeholder="例如：杭州客户网站"
          maxLength={40}
        />
      </label>

      <div className="project-form-row">
        <label className="field">
          <span className="field-label">开始日期</span>
          <input
            type="date"
            value={draft.startDate}
            onFocus={() => setPickerTarget('start')}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                startDate: event.target.value,
              }))
              setFormError('')
            }}
          />
        </label>
        <label className="field">
          <span className="field-label">
            截止日期 <span className="optional">选填</span>
          </span>
          <input
            type="date"
            value={draft.endDate}
            min={draft.startDate}
            onFocus={() => setPickerTarget('end')}
            onChange={(event) => {
              setDraft((current) => ({
                ...current,
                endDate: event.target.value,
              }))
              setFormError('')
            }}
          />
        </label>
      </div>

      <label className="field">
        <span className="field-label">
          项目总预算 <span className="optional">选填</span>
        </span>
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step="1"
          value={draft.budget}
          onChange={(event) => {
            setDraft((current) => ({ ...current, budget: event.target.value }))
            setFormError('')
          }}
          placeholder="0"
        />
      </label>

      <div className="project-category-budget-block">
        <div className="project-form-section-head">
          <div>
            <h3>分类预算</h3>
            <p>只统计归入这个项目的支出；项目本身不设分类，每一笔消费保留自己的分类。</p>
          </div>
          {categoryBudgetTotal > 0 ? (
            <span
              className={
                budgetCents !== null &&
                budgetCents > 0 &&
                categoryBudgetTotal > budgetCents
                  ? 'is-over'
                  : ''
              }
            >
              合计 {formatMoney(categoryBudgetTotal / 100)}
            </span>
          ) : null}
        </div>
        <div className="project-category-budget-grid">
          {getTopLevelCategories('expense').map((category) => (
            <label
              className="project-category-budget-item"
              key={category.id}
            >
              <CategoryIcon id={category.id} size={15} />
              <span>{category.name}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={draft.categoryBudgets[category.id] ?? ''}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    categoryBudgets: {
                      ...current.categoryBudgets,
                      [category.id]: event.target.value,
                    },
                  }))
                  setFormError('')
                }}
                placeholder="不设"
                aria-label={`${category.name}预算`}
              />
            </label>
          ))}
        </div>
        {budgetCents !== null &&
        budgetCents > 0 &&
        categoryBudgetTotal > budgetCents ? (
          <p className="project-budget-warning">
            分类预算合计已超过项目总预算，仍可保存，但建议重新分配。
          </p>
        ) : null}
      </div>

      <label className="field">
        <span className="field-label">
          备注 <span className="optional">选填</span>
        </span>
        <textarea
          rows={2}
          value={draft.note}
          onChange={(event) =>
            setDraft((current) => ({ ...current, note: event.target.value }))
          }
          placeholder="项目背景、客户或交付内容"
          maxLength={120}
        />
      </label>

      {formError ? (
        <p className="form-error" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="project-editor-actions">
        <button
          type="button"
          className="button ghost"
          onClick={() => setEditorMode(null)}
        >
          取消
        </button>
        <button type="submit" className="button primary">
          {editorMode === 'edit' ? '保存修改' : '创建项目'}
        </button>
      </div>
    </form>
  )

  const renderDetail = (project: Project) => {
    const stats = projectStats.get(project.id)
    const summary = stats?.summary ?? {
      projectId: project.id,
      totalExpenseCents: 0,
      totalIncomeCents: 0,
      netCents: 0,
      byMonth: [],
    }
    const phase = projectPhase(project, today)
    const archived = phase === 'archived'
    const totalExpenseCents = summary.totalExpenseCents
    const totalBudgetCents = project.budgetCents
    const remainingCents = (totalBudgetCents ?? 0) - totalExpenseCents
    const usedRatio =
      totalBudgetCents && totalBudgetCents > 0
        ? totalExpenseCents / totalBudgetCents
        : 0
    const categoryRows = getTopLevelCategories('expense').map((category) => ({
      category,
      spentCents: stats?.categoryCents.get(category.id) ?? 0,
      budgetCents: project.categoryBudgetsCents?.[category.id],
    })).filter(
      (row) => row.spentCents > 0 || (row.budgetCents ?? 0) > 0,
    )

    return (
      <>
        <div className="project-detail-head">
          <div className="project-detail-title">
            <p className="card-kicker">PROJECT</p>
            <div className="project-detail-name">
              <span
                className={`project-list-swatch ptone-${projectTone(project.id)}`}
                aria-hidden="true"
              />
              <h2>{project.name}</h2>
              <span className={`project-status is-${phase}`}>
                {phaseLabel(phase)}
              </span>
            </div>
            <p className="project-detail-dates">
              {formatProjectRange(project)} · {stats?.count ?? 0} 笔流水
            </p>
          </div>
          <div className="project-detail-actions">
            <button
              type="button"
              className="button secondary"
              onClick={() => startEdit(project)}
            >
              <Pencil size={15} />
              编辑
            </button>
            {!archived ? (
              <button
                type="button"
                className="button primary"
                onClick={() => onAddTransaction(project.id)}
              >
                <Plus size={15} />
                记一笔
              </button>
            ) : null}
          </div>
        </div>

        {project.note ? <p className="project-detail-note">{project.note}</p> : null}

        {archived ? (
          <p className="project-archived-note">
            已归档项目只能查看历史流水；恢复后可以继续记账。
          </p>
        ) : null}

        <div className="project-detail-stats">
          <div className="project-stat">
            <span>项目总支出</span>
            <strong>{formatMoney(totalExpenseCents / 100)}</strong>
          </div>
          <div className="project-stat">
            <span>项目预算</span>
            <strong>
              {totalBudgetCents
                ? formatMoney(totalBudgetCents / 100)
                : '未设置'}
            </strong>
          </div>
          <div className="project-stat">
            <span>{remainingCents < 0 ? '已超出' : '预算剩余'}</span>
            <strong className={remainingCents < 0 ? 'is-over' : ''}>
              {totalBudgetCents
                ? formatMoney(Math.abs(remainingCents) / 100)
                : '—'}
            </strong>
          </div>
          <div className="project-stat">
            <span>支出笔数</span>
            <strong>{stats?.count ?? 0} 笔</strong>
          </div>
        </div>

        {totalBudgetCents ? (
          <div className="project-detail-budget">
            <div className="project-budget-head">
              <span>项目预算使用</span>
              <span className={remainingCents < 0 ? 'is-over' : ''}>
                {formatPercent(usedRatio * 100)} ·{' '}
                {remainingCents < 0 ? '超出' : '剩余'}{' '}
                {formatMoney(Math.abs(remainingCents) / 100)}
              </span>
            </div>
            <div className="project-budget-meter">
              <span
                className={remainingCents < 0 ? 'is-over' : ''}
                style={{ width: `${Math.min(usedRatio * 100, 100)}%` }}
              />
            </div>
          </div>
        ) : null}

        <div className="project-detail-manage">
          {archived ? (
            <button
              type="button"
              className="project-manage-primary"
              onClick={() => onToggleProjectArchive(project.id)}
            >
              <Archive size={15} />
              恢复项目
            </button>
          ) : (
            <>
              <button
                type="button"
                className="project-manage-primary"
                onClick={() => onToggleProjectStatus(project.id)}
              >
                {project.status === 'active' ? (
                  <>
                    <Pause size={15} />
                    结束项目
                  </>
                ) : (
                  <>
                    <Play size={15} />
                    重新启用
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => onToggleProjectArchive(project.id)}
              >
                <Archive size={13} />
                归档
              </button>
            </>
          )}
          <button
            type="button"
            className="project-manage-danger"
            onClick={() => onDeleteProject(project.id)}
            title="删除项目，已归入该项目的流水会转为日常支出"
          >
            <Trash2 size={14} />
            删除项目
          </button>
        </div>

        <section className="project-detail-section" aria-labelledby="project-category-heading">
          <div className="project-section-head">
            <div>
              <h3 id="project-category-heading">分类预算</h3>
              <p>项目不设分类；每一笔支出自己的分类会归到这里。</p>
            </div>
            <span>{categoryRows.length} 个分类</span>
          </div>

          {categoryRows.length === 0 ? (
            <p className="project-section-empty">
              还没有分类支出或分类预算。记一笔项目支出后，这里会自动汇总。
            </p>
          ) : (
            <div className="project-category-list">
              {categoryRows.map(({ category, spentCents, budgetCents }) => {
                const over =
                  budgetCents !== undefined && spentCents > budgetCents
                const ratio =
                  budgetCents && budgetCents > 0
                    ? spentCents / budgetCents
                    : 0
                const share =
                  totalExpenseCents > 0
                    ? spentCents / totalExpenseCents
                    : 0
                return (
                  <div className="project-category-row" key={category.id}>
                    <CategoryIcon id={category.id} size={17} />
                    <div className="project-category-main">
                      <div className="project-category-line">
                        <span>{category.name}</span>
                        <span>
                          {formatMoney(spentCents / 100)}
                          {budgetCents
                            ? ` / ${formatMoney(budgetCents / 100)}`
                            : ` · ${formatPercent(share * 100)}`}
                        </span>
                      </div>
                      {budgetCents ? (
                        <div className="project-category-meter">
                          <span
                            className={over ? 'is-over' : ''}
                            style={{
                              width: `${Math.min(ratio * 100, 100)}%`,
                            }}
                          />
                        </div>
                      ) : null}
                    </div>
                    {over ? <span className="project-category-over">超出</span> : null}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        <section className="project-detail-section" aria-labelledby="project-expense-heading">
          <div className="project-section-head">
            <div>
              <h3 id="project-expense-heading">项目流水</h3>
              <p>共用支出只显示归入本项目的金额。</p>
            </div>
            <span>{projectTransactions.length} 笔</span>
          </div>

          {projectTransactions.length === 0 ? (
            <div className="project-section-empty">
              <p>这个项目还没有流水。</p>
              {!archived ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => onAddTransaction(project.id)}
                >
                  <Plus size={14} />
                  记第一笔
                </button>
              ) : null}
            </div>
          ) : (
            <div className="project-expense-list">
              {projectTransactions.map((transaction) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  projects={projects}
                  projectId={project.id}
                  onEdit={onEditTransaction}
                  onDelete={onDeleteTransaction}
                  showDate
                  compact
                />
              ))}
            </div>
          )}
        </section>
      </>
    )
  }

  return (
    <div className="page-stack projects-page">
      <section className="card project-calendar-card" aria-labelledby="project-calendar-heading">
        <div className="project-calendar-head">
          <div>
            <p className="card-kicker">PROJECT CALENDAR</p>
            <h2 id="project-calendar-heading">{monthLabel(calendarMonth)}</h2>
            <p className="card-sub">
              以日历为底板，点选日期定下项目的开始与截止。
            </p>
          </div>
          <div className="project-calendar-nav">
            <button
              type="button"
              className="icon-button"
              onClick={() => setCalendarMonth((current) => shiftMonth(current, -1))}
              aria-label="上个月"
            >
              <ChevronLeft size={17} />
            </button>
            <button
              type="button"
              className="button secondary project-today-button"
              onClick={() => setCalendarMonth(currentMonthKey())}
            >
              今天
            </button>
            <button
              type="button"
              className="icon-button"
              onClick={() => setCalendarMonth((current) => shiftMonth(current, 1))}
              aria-label="下个月"
            >
              <ChevronRight size={17} />
            </button>
          </div>
        </div>

        <div className="project-calendar-weekdays" aria-hidden="true">
          {WEEKDAYS.map((weekday) => (
            <span key={weekday}>{weekday}</span>
          ))}
        </div>

        <div className="project-calendar-grid">
          {calendarDays.map((day) => {
            const dayProjects = filteredProjects
              .filter((project) => projectCoversDate(project, day.key))
              .sort(
                (left, right) =>
                  Number(right.id === selectedId) -
                  Number(left.id === selectedId),
              )
            const inRange = Boolean(
              rangeStart && rangeEnd && day.key >= rangeStart && day.key <= rangeEnd,
            )
            const classNames = [
              'calendar-day',
              day.inMonth ? '' : 'is-outside',
              day.isToday ? 'is-today' : '',
              inRange ? 'is-in-range' : '',
              day.key === rangeStart ? 'is-range-start' : '',
              rangeEnd && day.key === rangeEnd ? 'is-range-end' : '',
            ]
              .filter(Boolean)
              .join(' ')
            return (
              <button
                type="button"
                key={day.key}
                className={classNames}
                onClick={() => handleDayClick(day)}
                aria-label={`${day.key}${
                  dayProjects.length > 0
                    ? `，${dayProjects.map((project) => project.name).join('、')}`
                    : ''
                }`}
              >
                <span className="calendar-day-number">{day.day}</span>
                <span className="calendar-day-strips" aria-hidden="true">
                  {dayProjects.slice(0, 3).map((project) => (
                    <span
                      key={project.id}
                      className={`calendar-project-strip ptone-${projectTone(project.id)}`}
                    />
                  ))}
                </span>
                {dayProjects.length > 3 ? (
                  <span className="calendar-day-more" aria-hidden="true">
                    +{dayProjects.length - 3}
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>

        <div className="project-calendar-foot">
          <p className="project-calendar-hint">
            {editorMode
              ? `正在点选${pickerTarget === 'start' ? '开始日期' : '截止日期'}：点一天即可填入。`
              : '点空白日期开始新建项目；点项目色条查看已有项目。'}
          </p>
          {legendProjects.length > 0 ? (
            <div className="project-calendar-legend" aria-label="项目颜色图例">
              {legendProjects.slice(0, 8).map((project) => (
                <button
                  type="button"
                  key={project.id}
                  className={`project-legend-item ptone-${projectTone(project.id)}`}
                  onClick={() => selectProject(project)}
                >
                  <span aria-hidden="true" />
                  {project.name}
                </button>
              ))}
              {legendProjects.length > 8 ? (
                <span className="project-legend-more">
                  +{legendProjects.length - 8}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <div className="projects-workspace">
        <aside className="card project-list-card" aria-labelledby="project-list-heading">
          <div className="project-list-head">
            <div>
              <p className="card-kicker">PROJECTS</p>
              <h2 id="project-list-heading">项目</h2>
            </div>
            <button
              type="button"
              className="button secondary project-new-button"
              onClick={() => startCreate()}
            >
              <FolderPlus size={15} />
              新建
            </button>
          </div>

          <div className="project-filter-tabs" role="group" aria-label="项目筛选">
            {FILTERS.map((item) => (
              <button
                type="button"
                key={item.id}
                className={filter === item.id ? 'is-active' : ''}
                onClick={() => setFilter(item.id)}
                aria-pressed={filter === item.id}
              >
                {item.label}
                <span>{filterCounts[item.id]}</span>
              </button>
            ))}
          </div>

          {filteredProjects.length === 0 ? (
            <p className="project-list-empty">
              {filter === 'archived'
                ? '没有归档项目。'
                : '这里还没有项目。点日历上的日期，或新建一个。'}
            </p>
          ) : (
            <div className="project-list">
              {filteredProjects.map((project) => {
                const stats = projectStats.get(project.id)
                const phase = projectPhase(project, today)
                return (
                  <button
                    type="button"
                    key={project.id}
                    className={`project-list-item${selectedId === project.id ? ' is-selected' : ''}`}
                    onClick={() => selectProject(project)}
                  >
                    <span
                      className={`project-list-swatch ptone-${projectTone(project.id)}`}
                      aria-hidden="true"
                    />
                    <span className="project-list-main">
                      <span className="project-list-title">
                        <strong>{project.name}</strong>
                        <span className={`project-status is-${phase}`}>
                          {phaseLabel(phase)}
                        </span>
                      </span>
                      <small>
                        {formatProjectRange(project)} · {stats?.count ?? 0} 笔
                      </small>
                    </span>
                    <span className="project-list-amount">
                      {formatMoney((stats?.summary.totalExpenseCents ?? 0) / 100)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </aside>

        <section className="card project-detail-card" aria-label="项目详情">
          {editorMode ? (
            renderEditor()
          ) : selectedProject ? (
            renderDetail(selectedProject)
          ) : (
            <div className="project-empty-detail">
              <span className="project-empty-icon" aria-hidden="true">
                <CalendarDays size={26} />
              </span>
              <h2>把项目放进日历里</h2>
              <p>
                在日历上点一个空白日期作为开始，再填写项目名称、总预算和分类预算。
                项目可以有多笔支出，每一笔都保留自己的分类。
              </p>
              <button
                type="button"
                className="button primary"
                onClick={() => startCreate()}
              >
                <Plus size={15} />
                新建项目
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
