import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { CalendarRange, Plus, Trash2 } from 'lucide-react'
import { CategoryIcon } from './CategoryIcon'
import { getCurrency } from '../lib/currency'
import {
  MAX_RANGE_DAYS,
  eachDateInRange,
  getDailyCategorySpendCents,
  getRangeBudgetMetrics,
  getRangeBudgetWarnings,
  newRangeBudgetId,
  shiftDateKey,
} from '../lib/budget'
import {
  parseCents,
  scaleValuesToTotalCents,
  splitEvenlyCents,
} from '../lib/budgetForm'
import { formatRangeLabel, rangeTitle } from '../lib/budgetLabels'
import {
  formatMoney,
  formatPercent,
  formatShortDate,
  localDateKey,
} from '../lib/utils'
import type {
  Category,
  Currency,
  DailyBudgetMode,
  LedgerTransaction,
  RangeBudget,
} from '../types'

interface RangeBudgetSettingsProps {
  ranges: RangeBudget[]
  transactions: LedgerTransaction[]
  /** Projects whose spending also counts toward range budgets. */
  countedProjectIds: ReadonlySet<string>
  categories: Category[]
  currency: Currency
  /** Seeds the amount of a brand-new range. */
  defaultAmountCents: number
  onSave: (range: RangeBudget) => void
  onDelete: (id: string) => Promise<boolean>
}

interface RangeDraft {
  id: string
  name: string
  startDate: string
  endDate: string
  amount: string
  mode: DailyBudgetMode
  /** Date → yuan input. */
  daily: Record<string, string>
  /** Category id → yuan input. */
  categories: Record<string, string>
}

const DAILY_MODES: Array<{ id: DailyBudgetMode; label: string }> = [
  { id: 'off', label: '关闭' },
  { id: 'auto', label: '自动均分' },
  { id: 'manual', label: '手动自定义' },
]

function makeDraft(range: RangeBudget): RangeDraft {
  const dates = eachDateInRange(range.startDate, range.endDate)
  // A plan without manual days seeds an exact even split, so switching to
  // manual mode never starts with a rounding mismatch.
  const evenSplit = range.dailyAmountsCents
    ? null
    : splitEvenlyCents(range.amountCents, Math.max(dates.length, 1))
  const daily: Record<string, string> = {}
  dates.forEach((date, index) => {
    const cents =
      range.dailyAmountsCents?.[date] ?? evenSplit?.[index] ?? 0
    daily[date] = (cents / 100).toFixed(2)
  })
  const categories: Record<string, string> = {}
  for (const [categoryId, cents] of Object.entries(
    range.categoryBudgetsCents ?? {},
  )) {
    categories[categoryId] = (cents / 100).toFixed(2)
  }
  return {
    id: range.id,
    name: range.name ?? '',
    startDate: range.startDate,
    endDate: range.endDate,
    amount: (range.amountCents / 100).toFixed(2),
    mode: range.dailyMode,
    daily,
    categories,
  }
}

function buildRangeBudget(
  draft: RangeDraft,
  categories: Category[],
): { range: RangeBudget | null; error: string } {
  const dates = eachDateInRange(draft.startDate, draft.endDate)
  if (dates.length === 0) {
    return { range: null, error: '结束日期需要晚于或等于开始日期' }
  }
  if (dates.length > MAX_RANGE_DAYS) {
    return { range: null, error: `区间最长 ${MAX_RANGE_DAYS} 天，请缩短范围` }
  }
  const amountCents = parseCents(draft.amount)
  if (amountCents === null || amountCents <= 0) {
    return { range: null, error: '请输入大于 0 的区间预算金额' }
  }

  let dailyAmountsCents: Record<string, number> | undefined
  if (draft.mode === 'manual') {
    dailyAmountsCents = {}
    for (const date of dates) {
      const raw = draft.daily[date] ?? ''
      const cents = raw.trim() ? parseCents(raw) : 0
      if (cents === null) {
        return { range: null, error: '每日额度需要是大于等于 0 的金额' }
      }
      dailyAmountsCents[date] = cents
    }
  }

  const categoryBudgetsCents: Record<string, number> = {}
  for (const category of categories) {
    const raw = draft.categories[category.id] ?? ''
    if (!raw.trim()) continue
    const cents = parseCents(raw)
    if (cents === null) {
      return { range: null, error: '分类预算需要是大于等于 0 的金额' }
    }
    categoryBudgetsCents[category.id] = cents
  }

  const name = draft.name.trim()
  return {
    range: {
      id: draft.id,
      ...(name ? { name } : {}),
      startDate: draft.startDate,
      endDate: draft.endDate,
      amountCents,
      dailyMode: draft.mode,
      ...(dailyAmountsCents && Object.keys(dailyAmountsCents).length > 0
        ? { dailyAmountsCents }
        : {}),
      ...(Object.keys(categoryBudgetsCents).length > 0
        ? { categoryBudgetsCents }
        : {}),
    },
    error: '',
  }
}

export function RangeBudgetSettings({
  ranges,
  transactions,
  countedProjectIds,
  categories,
  currency,
  defaultAmountCents,
  onSave,
  onDelete,
}: RangeBudgetSettingsProps) {
  const [draft, setDraft] = useState<RangeDraft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [error, setError] = useState('')
  const editorRef = useRef<HTMLFormElement | null>(null)
  const today = localDateKey()

  // The editor lives below the range list, so opening it should reveal it even
  // when the list is long or the settings panel is scrolled to the bottom.
  useEffect(() => {
    if (!draft) return
    editorRef.current?.scrollIntoView({ block: 'nearest' })
  }, [draft?.id, isNew])

  const topCategories = useMemo(
    () =>
      categories.filter(
        (category) => category.type === 'expense' && !category.parentId,
      ),
    [categories],
  )

  const symbol = getCurrency(currency).symbol

  // Each card shows its own progress against its own dates.
  const cards = useMemo(
    () =>
      ranges.map((range) => ({
        range,
        metrics: getRangeBudgetMetrics(
          transactions,
          range,
          today,
          countedProjectIds,
        ),
      })),
    [ranges, transactions, today, countedProjectIds],
  )

  const dates = useMemo(
    () => (draft ? eachDateInRange(draft.startDate, draft.endDate) : []),
    [draft?.startDate, draft?.endDate],
  )

  const built = useMemo(
    () => (draft ? buildRangeBudget(draft, topCategories) : null),
    [draft, topCategories],
  )

  const preview = useMemo(() => {
    if (!built?.range) return null
    return getRangeBudgetMetrics(
      transactions,
      built.range,
      today,
      countedProjectIds,
    )
  }, [built?.range, transactions, today, countedProjectIds])

  const categorySpend = useMemo(() => {
    if (dates.length === 0) return new Map<string, number>()
    return getDailyCategorySpendCents(
      transactions,
      dates[0],
      dates[dates.length - 1],
      countedProjectIds,
    )
  }, [transactions, dates, countedProjectIds])

  const daily = preview?.daily ?? null
  const warnings = preview ? getRangeBudgetWarnings(preview) : []
  const amountCents = built?.range?.amountCents ?? null

  const categoryDraftCents = useMemo(() => {
    const result: Record<string, number> = {}
    if (!draft) return result
    for (const category of topCategories) {
      const raw = draft.categories[category.id] ?? ''
      if (!raw.trim()) continue
      const cents = parseCents(raw)
      if (cents !== null) result[category.id] = cents
    }
    return result
  }, [draft?.categories, topCategories])

  const categoryTotalCents = Object.values(categoryDraftCents).reduce(
    (sum, value) => sum + value,
    0,
  )
  const unallocatedCents =
    amountCents === null ? null : amountCents - categoryTotalCents

  const manualTotalCents = daily?.manualTotalCents ?? null
  const manualMismatchCents =
    draft?.mode === 'manual' &&
    amountCents !== null &&
    manualTotalCents !== null
      ? manualTotalCents - amountCents
      : 0

  const startCreate = () => {
    const startDate = localDateKey()
    setDraft(
      makeDraft({
        id: newRangeBudgetId(),
        startDate,
        endDate: shiftDateKey(startDate, 6),
        amountCents: Math.max(defaultAmountCents, 100),
        dailyMode: 'off',
      }),
    )
    setIsNew(true)
    setError('')
  }

  const startEdit = (range: RangeBudget) => {
    setDraft(makeDraft(range))
    setIsNew(false)
    setError('')
  }

  const closeEditor = () => {
    setDraft(null)
    setIsNew(false)
    setError('')
  }

  const updateDates = (patch: { startDate?: string; endDate?: string }) => {
    setDraft((current) => {
      if (!current) return current
      const next = { ...current, ...patch }
      const nextDates = eachDateInRange(next.startDate, next.endDate)
      if (nextDates.length === 0) return next
      const cents = parseCents(next.amount)
      const split =
        cents !== null && cents > 0 && nextDates.length <= MAX_RANGE_DAYS
          ? splitEvenlyCents(cents, nextDates.length)
          : null
      const dailyInputs: Record<string, string> = {}
      nextDates.forEach((date, index) => {
        dailyInputs[date] =
          current.daily[date] ??
          (split ? (split[index] / 100).toFixed(2) : '')
      })
      return { ...next, daily: dailyInputs }
    })
    setError('')
  }

  const updateDaily = (date: string, value: string) => {
    setDraft((current) =>
      current
        ? { ...current, daily: { ...current.daily, [date]: value } }
        : current,
    )
    setError('')
  }

  const updateCategory = (categoryId: string, value: string) => {
    setDraft((current) =>
      current
        ? {
            ...current,
            categories: { ...current.categories, [categoryId]: value },
          }
        : current,
    )
    setError('')
  }

  const distributeWholeRange = () => {
    if (!draft || dates.length === 0) return
    const cents = parseCents(draft.amount)
    if (cents === null || cents <= 0) {
      setError('先填写区间预算金额，再按整段均分')
      return
    }
    const values = splitEvenlyCents(cents, dates.length)
    const dailyInputs: Record<string, string> = {}
    dates.forEach((date, index) => {
      dailyInputs[date] = (values[index] / 100).toFixed(2)
    })
    setDraft((current) =>
      current ? { ...current, mode: 'manual', daily: dailyInputs } : current,
    )
    setError('')
  }

  const distributeRemaining = () => {
    if (!draft || !daily) {
      setError('先切换到手动自定义，再重排每日额度')
      return
    }
    const cents = parseCents(draft.amount)
    if (cents === null || cents <= 0) {
      setError('先填写区间预算金额，再重排每日额度')
      return
    }
    const todayIndex = Math.max(daily.today - 1, 0)
    const remainingDates = dates.slice(todayIndex)
    if (remainingDates.length === 0) return
    const spentBeforeToday = daily.days
      .slice(0, todayIndex)
      .reduce((sum, entry) => sum + entry.spentCents, 0)
    const allowance = Math.max(
      0,
      Math.floor((cents - spentBeforeToday) / remainingDates.length),
    )
    const dailyInputs = { ...draft.daily }
    for (const date of remainingDates) {
      dailyInputs[date] = (allowance / 100).toFixed(2)
    }
    setDraft((current) =>
      current ? { ...current, mode: 'manual', daily: dailyInputs } : current,
    )
    setError('')
  }

  const alignDailyToRange = () => {
    if (!draft || dates.length === 0) return
    const cents = parseCents(draft.amount)
    if (cents === null || cents <= 0) {
      setError('先填写区间预算金额，再对齐每日额度')
      return
    }
    const parsed = dates.map(
      (date) => parseCents(draft.daily[date] ?? '') ?? 0,
    )
    const total = parsed.reduce((sum, value) => sum + value, 0)
    if (total <= 0) {
      setError('每日额度合计为 0，无法对齐区间预算')
      return
    }
    const scaled = scaleValuesToTotalCents(parsed, cents)
    const dailyInputs: Record<string, string> = {}
    dates.forEach((date, index) => {
      dailyInputs[date] = (scaled[index] / 100).toFixed(2)
    })
    setDraft((current) =>
      current ? { ...current, daily: dailyInputs } : current,
    )
    setError('')
  }

  const clearCategoryBudgets = () => {
    setDraft((current) => {
      if (!current) return current
      const nextCategories: Record<string, string> = {}
      for (const category of topCategories) nextCategories[category.id] = ''
      return { ...current, categories: nextCategories }
    })
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!built?.range) {
      setError(built?.error ?? '请检查区间预算')
      return
    }
    setError('')
    onSave(built.range)
    setIsNew(false)
  }

  const handleDelete = async (id: string) => {
    const removed = await onDelete(id)
    if (removed && draft?.id === id) closeEditor()
  }

  return (
    <div className="range-budget-settings">
      <div className="range-budget-list-head">
        <div>
          <h4>区间预算</h4>
          <p>
            为旅行、装修或任意一段时间单独设预算。规则和月度预算一致：金额、每日额度与分类上限都照常生效。
          </p>
        </div>
        <button
          type="button"
          className="button secondary range-budget-create"
          onClick={startCreate}
        >
          <Plus size={15} />
          新建区间
        </button>
      </div>

      {cards.length > 0 ? (
        <ul className="range-budget-list">
          {cards.map(({ range, metrics }) => {
            const statusKey = metrics.active
              ? 'active'
              : today < range.startDate
                ? 'upcoming'
                : 'ended'
            const statusLabel =
              statusKey === 'active'
                ? '进行中'
                : statusKey === 'upcoming'
                  ? '未开始'
                  : '已结束'
            const title = rangeTitle(range)
            return (
              <li
                key={range.id}
                className={`range-budget-card${
                  metrics.active ? ' is-active' : ''
                }${draft?.id === range.id ? ' is-editing' : ''}`}
              >
                <button
                  type="button"
                  className="range-budget-card-main"
                  onClick={() => startEdit(range)}
                >
                  <span className="range-budget-card-head">
                    <span className="range-budget-card-title">
                      <CalendarRange size={15} />
                      {title}
                    </span>
                    <em className={`range-budget-status is-${statusKey}`}>
                      {statusLabel}
                    </em>
                  </span>
                  <span className="range-budget-card-dates">
                    {formatRangeLabel(range.startDate, range.endDate)} ·{' '}
                    {metrics.dayCount} 天
                    {metrics.daily
                      ? ` · ${
                          metrics.daily.mode === 'auto'
                            ? '每日自动均分'
                            : '每日自定义'
                        }`
                      : ''}
                  </span>
                  <span className="range-budget-card-amounts">
                    <span>
                      已用 {formatMoney(metrics.spentCents / 100)}
                      <small> / {formatMoney(metrics.amountCents / 100)}</small>
                    </span>
                    <strong
                      className={metrics.remainingCents < 0 ? 'is-negative' : ''}
                    >
                      {metrics.remainingCents < 0 ? '超出 ' : '剩余 '}
                      {formatMoney(Math.abs(metrics.remainingCents) / 100)}
                    </strong>
                  </span>
                  <span className="range-budget-card-meter" aria-hidden="true">
                    <span
                      className={metrics.overBudget ? 'is-over' : ''}
                      style={{
                        width: `${Math.min(metrics.ratio * 100, 100)}%`,
                      }}
                    />
                  </span>
                  <span className="range-budget-card-foot">
                    已用 {formatPercent(metrics.ratio * 100)}
                    {metrics.active
                      ? ` · 还剩 ${metrics.daysLeft} 天`
                      : metrics.daysLeft === 0 && today > range.endDate
                        ? ' · 已结束'
                        : ' · 尚未开始'}
                  </span>
                </button>
                <button
                  type="button"
                  className="icon-button icon-button--small range-budget-delete"
                  onClick={() => void handleDelete(range.id)}
                  aria-label={`删除区间预算「${title}」`}
                  title="删除区间预算"
                >
                  <Trash2 size={15} />
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="budget-mode-note">
          还没有区间预算。点「新建区间」为一段时间单独安排。
        </p>
      )}

      {draft ? (
        <form
          ref={editorRef}
          className="budget-plan-form range-budget-editor"
          onSubmit={handleSubmit}
        >
          <div className="range-budget-editor-head">
            <h4>{isNew ? '新建区间预算' : '编辑区间预算'}</h4>
            <button
              type="button"
              className="text-link"
              onClick={closeEditor}
            >
              收起
            </button>
          </div>

          <section className="budget-block">
            <div className="budget-block-head">
              <div>
                <h4>区间与金额</h4>
                <p>
                  跨月时整段按连续天数计算，不会拆到各月，也不与月度预算互相校验。
                </p>
              </div>
            </div>

            <label className="range-name-field">
              <span>名称（可选）</span>
              <input
                type="text"
                value={draft.name}
                onChange={(event) => {
                  setDraft((current) =>
                    current
                      ? { ...current, name: event.target.value }
                      : current,
                  )
                  setError('')
                }}
                placeholder="例如：国庆旅行"
                aria-label="区间预算名称"
              />
            </label>

            <div className="range-date-row">
              <label className="range-date-field">
                <span>开始日期</span>
                <input
                  type="date"
                  value={draft.startDate}
                  onChange={(event) =>
                    updateDates({ startDate: event.target.value })
                  }
                  aria-label="区间开始日期"
                />
              </label>
              <label className="range-date-field">
                <span>结束日期</span>
                <input
                  type="date"
                  value={draft.endDate}
                  onChange={(event) =>
                    updateDates({ endDate: event.target.value })
                  }
                  aria-label="区间结束日期"
                />
              </label>
              <div className="range-date-summary">
                <span>共 {dates.length} 天</span>
                <small>{formatRangeLabel(draft.startDate, draft.endDate)}</small>
              </div>
            </div>

            <label className="budget-input budget-input--wide">
              <span>{symbol}</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                value={draft.amount}
                onChange={(event) => {
                  setDraft((current) =>
                    current
                      ? { ...current, amount: event.target.value }
                      : current,
                  )
                  setError('')
                }}
                placeholder="0.00"
                aria-label="区间预算金额"
              />
            </label>
          </section>

          {preview ? (
            <div className="budget-preview">
              <div className="budget-preview-copy">
                <span>
                  已用 {formatMoney(preview.spentCents / 100)} /{' '}
                  {formatMoney(preview.amountCents / 100)}
                </span>
                <strong className={preview.overBudget ? 'is-negative' : ''}>
                  {preview.overBudget ? '超出 ' : '剩余 '}
                  {formatMoney(Math.abs(preview.remainingCents) / 100)}
                </strong>
              </div>
              <div className="budget-preview-meter" aria-hidden="true">
                <span
                  className={preview.overBudget ? 'is-over' : ''}
                  style={{ width: `${Math.min(preview.ratio * 100, 100)}%` }}
                />
              </div>
            </div>
          ) : null}

          <section className="budget-block">
            <div className="budget-block-head">
              <div>
                <h4>每日预算</h4>
                <p>
                  每日额度覆盖整个区间。跨月时只要求所有天的额度与区间金额对齐，不按月分别求和。
                </p>
              </div>
            </div>

            <div
              className="budget-mode-switch"
              role="radiogroup"
              aria-label="区间每日预算方式"
            >
              {DAILY_MODES.map((option) => {
                const active = draft.mode === option.id
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={active ? 'is-active' : ''}
                    onClick={() => {
                      setDraft((current) =>
                        current ? { ...current, mode: option.id } : current,
                      )
                      setError('')
                    }}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>

            {draft.mode === 'off' ? (
              <p className="budget-mode-note">
                关闭后只按整个区间查看进度；打开后会显示今天的额度与超支预警。
              </p>
            ) : null}

            {draft.mode === 'auto' ? (
              <div className="budget-auto-preview">
                <div>
                  <span>区间均分</span>
                  <strong>
                    {daily ? formatMoney(daily.baseDailyCents / 100) : '—'}
                  </strong>
                </div>
                {preview?.active && daily ? (
                  <>
                    <div>
                      <span>今日额度</span>
                      <strong>
                        {formatMoney(daily.todayBudgetCents / 100)}
                      </strong>
                    </div>
                    <div>
                      <span>今日已用</span>
                      <strong
                        className={
                          daily.todayRemainingCents < 0 ? 'is-negative' : ''
                        }
                      >
                        {formatMoney(daily.todaySpentCents / 100)}
                      </strong>
                    </div>
                    <div>
                      <span>明天预计</span>
                      <strong>
                        {daily.tomorrowBudgetCents === null
                          ? '区间收拢'
                          : formatMoney(daily.tomorrowBudgetCents / 100)}
                      </strong>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {draft.mode === 'manual' ? (
              <div className="budget-manual">
                <div className="budget-manual-toolbar">
                  <span>
                    每日合计{' '}
                    <strong>
                      {manualTotalCents === null
                        ? '—'
                        : formatMoney(manualTotalCents / 100)}
                    </strong>
                    {manualMismatchCents !== 0 && amountCents !== null ? (
                      <em
                        className={
                          manualMismatchCents > 0 ? 'is-over' : 'is-under'
                        }
                      >
                        {manualMismatchCents > 0 ? '高于' : '低于'}区间预算{' '}
                        {formatMoney(Math.abs(manualMismatchCents) / 100)}
                      </em>
                    ) : null}
                  </span>
                  <div className="budget-manual-actions">
                    <button
                      type="button"
                      className="budget-quick-action"
                      onClick={distributeWholeRange}
                    >
                      按整段均分
                    </button>
                    {preview
                      ? preview.daysLeft > 0 && (
                          <button
                            type="button"
                            className="budget-quick-action"
                            onClick={distributeRemaining}
                          >
                            按剩余重排
                          </button>
                        )
                      : null}
                    <button
                      type="button"
                      className="budget-quick-action"
                      onClick={alignDailyToRange}
                    >
                      对齐区间预算
                    </button>
                  </div>
                </div>

                <div className="daily-input-grid daily-input-grid--range">
                  {dates.map((date, index) => {
                    const spentCents = daily?.days[index]?.spentCents ?? 0
                    return (
                      <label
                        key={date}
                        className={`daily-input${
                          date === today ? ' is-today' : ''
                        }`}
                      >
                        <span>
                          {formatShortDate(date)}
                          {spentCents > 0 ? (
                            <small>{formatMoney(spentCents / 100, false)}</small>
                          ) : null}
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="0.01"
                          value={draft.daily[date] ?? ''}
                          onChange={(event) =>
                            updateDaily(date, event.target.value)
                          }
                          aria-label={`${formatShortDate(date)}预算`}
                        />
                      </label>
                    )
                  })}
                </div>

                <p className="budget-mode-note">
                  手动额度不会因为当天超支而自动改写；可随时用「按剩余重排」把剩余区间预算重新分给后续日期。
                </p>
              </div>
            ) : null}
          </section>

          <section className="budget-block">
            <div className="budget-block-head">
              <div>
                <h4>分类预算</h4>
                <p>
                  上限只统计区间内的日常支出。留空表示这个分类不单独设限。
                </p>
              </div>
            </div>

            <div className="budget-category-form">
              {topCategories.map((category) => {
                const spentCents = categorySpend.get(category.id) ?? 0
                const capCents = categoryDraftCents[category.id]
                return (
                  <label className="budget-category-row" key={category.id}>
                    <CategoryIcon category={category} size={16} compact />
                    <span className="budget-category-label">
                      <strong>{category.name}</strong>
                      <small>
                        已用 {formatMoney(spentCents / 100)}
                        {capCents !== undefined && dates.length > 0
                          ? ` · 日均约 ${formatMoney(
                              capCents / 100 / dates.length,
                            )}`
                          : ' · 未设限'}
                      </small>
                    </span>
                    <span className="budget-category-input">
                      <span>{symbol}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={draft.categories[category.id] ?? ''}
                        onChange={(event) =>
                          updateCategory(category.id, event.target.value)
                        }
                        placeholder="不限"
                        aria-label={`${category.name}分类预算`}
                      />
                    </span>
                  </label>
                )
              })}
            </div>

            <div className="budget-category-summary">
              <span>
                已分配 {formatMoney(categoryTotalCents / 100)}
                {unallocatedCents !== null ? (
                  <em className={unallocatedCents < 0 ? 'is-over' : ''}>
                    {unallocatedCents >= 0 ? ' · 未分配 ' : ' · 超出区间预算 '}
                    {formatMoney(Math.abs(unallocatedCents) / 100)}
                  </em>
                ) : null}
              </span>
              {categoryTotalCents > 0 ? (
                <button
                  type="button"
                  className="budget-quick-action"
                  onClick={clearCategoryBudgets}
                >
                  清空分类预算
                </button>
              ) : null}
            </div>
          </section>

          {warnings.length > 0 ? (
            <div className="budget-alerts budget-alerts--settings">
              {warnings.slice(0, 4).map((warning) => (
                <div
                  className={`budget-alert is-${warning.tone}`}
                  key={`${warning.kind}-${warning.title}`}
                >
                  <div className="budget-alert-copy">
                    <strong>{warning.title}</strong>
                    <span>{warning.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="budget-form-actions">
            <button type="submit" className="button secondary">
              {isNew ? '创建区间预算' : '保存区间预算'}
            </button>
            <span>
              {isNew ? '保存后即可在概览里查看' : '只修改这个区间'}
              {preview ? ` · 已用 ${formatPercent(preview.ratio * 100)}` : ''}
            </span>
          </div>
        </form>
      ) : null}
    </div>
  )
}
