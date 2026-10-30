import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { CategoryIcon } from './CategoryIcon'
import { RangeBudgetSettings } from './RangeBudgetSettings'
import { getCurrency } from '../lib/currency'
import {
  applyBudgetAdjustment,
  getBudgetWarnings,
  getDailyCategorySpendCents,
  getMonthBudgetMetrics,
  monthDateBounds,
  resolveMonthBudget,
} from '../lib/budget'
import { formatAdjustmentTime } from '../lib/budgetLabels'
import {
  parseCents,
  scaleValuesToTotalCents,
  splitEvenlyCents,
} from '../lib/budgetForm'
import {
  currentMonthKey,
  daysInMonthOfKey,
  formatMoney,
  formatPercent,
  isCurrentMonth,
  monthLabel,
  monthShortLabel,
  shiftMonth,
} from '../lib/utils'
import type {
  BudgetBook,
  Category,
  Currency,
  DailyBudgetMode,
  LedgerTransaction,
  MonthBudget,
  RangeBudget,
} from '../types'

export type BudgetTab = 'month' | 'range'

interface BudgetSettingsProps {
  monthKey: string
  budgets: BudgetBook
  ranges: RangeBudget[]
  transactions: LedgerTransaction[]
  /** Projects whose spending also counts toward these budgets. */
  countedProjectIds: ReadonlySet<string>
  categories: Category[]
  currency: Currency
  /** Opens the range tab when the user came from a range panel. */
  focusTab?: BudgetTab
  onSave: (budget: MonthBudget) => void
  onRangeSave: (range: RangeBudget) => void
  onRangeDelete: (id: string) => Promise<boolean>
}

interface BudgetDraft {
  amount: string
  mode: DailyBudgetMode
  /** Day number → yuan input. */
  daily: Record<string, string>
  /** Category id → yuan input. */
  categories: Record<string, string>
}

const DAILY_MODES: Array<{ id: DailyBudgetMode; label: string }> = [
  { id: 'off', label: '关闭' },
  { id: 'auto', label: '自动均分' },
  { id: 'manual', label: '手动自定义' },
]

const BUDGET_TABS: Array<{ id: BudgetTab; label: string }> = [
  { id: 'month', label: '月度预算' },
  { id: 'range', label: '区间预算' },
]

function seedDraft(budget: MonthBudget, monthKey: string): BudgetDraft {
  const dayCount = daysInMonthOfKey(monthKey)
  // A plan without manual days seeds an exact even split, so switching to
  // manual mode never starts with a one-cent rounding mismatch.
  const evenSplit = budget.dailyAmountsCents
    ? null
    : splitEvenlyCents(budget.amountCents, dayCount)
  const daily: Record<string, string> = {}
  for (let day = 1; day <= dayCount; day += 1) {
    const cents =
      budget.dailyAmountsCents?.[String(day)] ?? evenSplit?.[day - 1] ?? 0
    daily[String(day)] = (cents / 100).toFixed(2)
  }
  const categories: Record<string, string> = {}
  for (const [categoryId, cents] of Object.entries(
    budget.categoryBudgetsCents ?? {},
  )) {
    categories[categoryId] = (cents / 100).toFixed(2)
  }
  return {
    amount: (budget.amountCents / 100).toFixed(2),
    mode: budget.dailyMode,
    daily,
    categories,
  }
}

/** Builds a plan from the draft, or explains the first invalid field. */
function buildDraftBudget(
  draft: BudgetDraft,
  monthKey: string,
  categories: Category[],
): { budget: MonthBudget | null; error: string } {
  const amountCents = parseCents(draft.amount)
  if (amountCents === null || amountCents <= 0) {
    return { budget: null, error: '请输入大于 0 的月预算金额' }
  }

  let dailyAmountsCents: Record<string, number> | undefined
  if (draft.mode === 'manual') {
    const dayCount = daysInMonthOfKey(monthKey)
    dailyAmountsCents = {}
    for (let day = 1; day <= dayCount; day += 1) {
      const raw = draft.daily[String(day)] ?? ''
      const cents = raw.trim() ? parseCents(raw) : 0
      if (cents === null) {
        return { budget: null, error: '每日额度需要是大于等于 0 的金额' }
      }
      dailyAmountsCents[String(day)] = cents
    }
  }

  const categoryBudgetsCents: Record<string, number> = {}
  for (const category of categories) {
    const raw = draft.categories[category.id] ?? ''
    if (!raw.trim()) continue
    const cents = parseCents(raw)
    if (cents === null) {
      return { budget: null, error: '分类预算需要是大于等于 0 的金额' }
    }
    categoryBudgetsCents[category.id] = cents
  }

  return {
    budget: {
      month: monthKey,
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

export function BudgetSettings({
  monthKey,
  budgets,
  ranges,
  transactions,
  countedProjectIds,
  categories,
  currency,
  focusTab,
  onSave,
  onRangeSave,
  onRangeDelete,
}: BudgetSettingsProps) {
  const [tab, setTab] = useState<BudgetTab>('month')
  const [selectedMonth, setSelectedMonth] = useState(monthKey)
  const [draft, setDraft] = useState<BudgetDraft>(() =>
    seedDraft(resolveMonthBudget(budgets, monthKey).budget, monthKey),
  )
  const [error, setError] = useState('')

  const topCategories = useMemo(
    () =>
      categories.filter(
        (category) => category.type === 'expense' && !category.parentId,
      ),
    [categories],
  )

  const resolved = useMemo(
    () => resolveMonthBudget(budgets, selectedMonth),
    [budgets, selectedMonth],
  )

  useEffect(() => {
    setSelectedMonth(monthKey)
  }, [monthKey])

  // Arriving from a range panel should land on the range tab directly.
  useEffect(() => {
    if (focusTab) setTab(focusTab)
  }, [focusTab])

  useEffect(() => {
    setDraft(seedDraft(resolveMonthBudget(budgets, selectedMonth).budget, selectedMonth))
    setError('')
  }, [budgets, selectedMonth])

  const built = useMemo(
    () => buildDraftBudget(draft, selectedMonth, topCategories),
    [draft, selectedMonth, topCategories],
  )

  const adjustments = resolved.budget.adjustments ?? []
  const baseAmountCents =
    resolved.budget.baseAmountCents ?? resolved.budget.amountCents
  const amountChanged =
    built.budget !== null &&
    built.budget.amountCents !== resolved.budget.amountCents

  const preview = useMemo(() => {
    if (!built.budget) return null
    return getMonthBudgetMetrics(
      transactions,
      selectedMonth,
      { ...budgets, [selectedMonth]: built.budget },
      countedProjectIds,
    )
  }, [built.budget, budgets, selectedMonth, transactions, countedProjectIds])

  const categorySpend = useMemo(() => {
    const bounds = monthDateBounds(selectedMonth)
    return getDailyCategorySpendCents(
      transactions,
      bounds.startDate,
      bounds.endDate,
      countedProjectIds,
    )
  }, [transactions, selectedMonth, countedProjectIds])

  const symbol = getCurrency(currency).symbol
  const dayCount = daysInMonthOfKey(selectedMonth)
  const daily = preview?.daily ?? null
  const warnings = preview ? getBudgetWarnings(preview) : []
  const amountCents = built.budget?.amountCents ?? null

  const categoryDraftCents = useMemo(() => {
    const result: Record<string, number> = {}
    for (const category of topCategories) {
      const raw = draft.categories[category.id] ?? ''
      if (!raw.trim()) continue
      const cents = parseCents(raw)
      if (cents !== null) result[category.id] = cents
    }
    return result
  }, [draft.categories, topCategories])

  const categoryTotalCents = Object.values(categoryDraftCents).reduce(
    (sum, value) => sum + value,
    0,
  )
  const unallocatedCents =
    amountCents === null ? null : amountCents - categoryTotalCents

  const updateDaily = (day: number, value: string) => {
    setDraft((current) => ({
      ...current,
      daily: { ...current.daily, [String(day)]: value },
    }))
    setError('')
  }

  const updateCategory = (categoryId: string, value: string) => {
    setDraft((current) => ({
      ...current,
      categories: { ...current.categories, [categoryId]: value },
    }))
    setError('')
  }

  const distributeWholeMonth = () => {
    const cents = parseCents(draft.amount)
    if (cents === null || cents <= 0) {
      setError('先填写月预算金额，再按整月均分')
      return
    }
    const values = splitEvenlyCents(cents, dayCount)
    const daily: Record<string, string> = {}
    for (let day = 1; day <= dayCount; day += 1) {
      daily[String(day)] = (values[day - 1] / 100).toFixed(2)
    }
    setDraft((current) => ({ ...current, mode: 'manual', daily }))
    setError('')
  }

  const distributeRemaining = () => {
    const cents = parseCents(draft.amount)
    if (cents === null || cents <= 0) {
      setError('先填写月预算金额，再重排每日额度')
      return
    }
    if (!daily) {
      setError('先切换到手动自定义，再重排每日额度')
      return
    }
    const today = daily.today
    const spentBeforeToday = daily.days
      .slice(0, Math.max(today - 1, 0))
      .reduce((sum, entry) => sum + entry.spentCents, 0)
    const remainingDays = Math.max(dayCount - today + 1, 1)
    const allowance = Math.max(
      0,
      Math.floor((cents - spentBeforeToday) / remainingDays),
    )
    const dailyInputs = { ...draft.daily }
    for (let day = today; day <= dayCount; day += 1) {
      dailyInputs[String(day)] = (allowance / 100).toFixed(2)
    }
    setDraft((current) => ({ ...current, mode: 'manual', daily: dailyInputs }))
    setError('')
  }

  const alignDailyToMonth = () => {
    const cents = parseCents(draft.amount)
    if (cents === null || cents <= 0) {
      setError('先填写月预算金额，再对齐每日额度')
      return
    }
    const parsed: number[] = []
    for (let day = 1; day <= dayCount; day += 1) {
      const value = parseCents(draft.daily[String(day)] ?? '') ?? 0
      parsed.push(value)
    }
    const total = parsed.reduce((sum, value) => sum + value, 0)
    if (total <= 0) {
      setError('每日额度合计为 0，无法对齐月预算')
      return
    }
    const scaled = scaleValuesToTotalCents(parsed, cents)
    const dailyInputs: Record<string, string> = {}
    for (let day = 1; day <= dayCount; day += 1) {
      dailyInputs[String(day)] = (scaled[day - 1] / 100).toFixed(2)
    }
    setDraft((current) => ({ ...current, daily: dailyInputs }))
    setError('')
  }

  const clearCategoryBudgets = () => {
    setDraft((current) => {
      const categories: Record<string, string> = {}
      for (const category of topCategories) categories[category.id] = ''
      return { ...current, categories }
    })
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!built.budget) {
      setError(built.error)
      return
    }
    setError('')

    // Settings own the original plan: changing it needs no reason. Only when
    // live adjustments exist does the new plan also close the old adjustment
    // chain, with an automatic note instead of a user-typed one.
    const historyBase: MonthBudget = {
      ...built.budget,
      amountCents: resolved.budget.amountCents,
      baseAmountCents,
      ...(adjustments.length > 0 ? { adjustments } : {}),
    }
    const next = !amountChanged
      ? historyBase
      : adjustments.length > 0
        ? applyBudgetAdjustment(historyBase, {
            amountCents: built.budget.amountCents,
            note: '在设置中重新设定原定预算',
            kind: 'replan',
            rebase: true,
          })
        : {
            ...built.budget,
            baseAmountCents: built.budget.amountCents,
          }
    onSave(next)
  }

  const sourceNote =
    resolved.source === 'set'
      ? '这个月已单独设置预算'
      : resolved.source === 'inherited' && resolved.sourceMonth
        ? `当前沿用 ${monthShortLabel(resolved.sourceMonth)} 的预算，保存后只修改 ${monthLabel(selectedMonth)}`
        : '当前使用默认预算，保存后开始记录这个月'

  const manualTotalCents = daily?.manualTotalCents ?? null
  const manualMismatchCents =
    draft.mode === 'manual' && amountCents !== null && manualTotalCents !== null
      ? manualTotalCents - amountCents
      : 0

  return (
    <div className="budget-settings">
      <div className="budget-tabs" role="tablist" aria-label="预算方式">
        {BUDGET_TABS.map((option) => {
          const active = tab === option.id
          return (
            <button
              key={option.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? 'is-active' : ''}
              onClick={() => setTab(option.id)}
            >
              {option.label}
            </button>
          )
        })}
      </div>

      {tab === 'range' ? (
        <RangeBudgetSettings
          ranges={ranges}
          transactions={transactions}
          countedProjectIds={countedProjectIds}
          categories={categories}
          currency={currency}
          defaultAmountCents={amountCents ?? resolved.budget.amountCents}
          onSave={onRangeSave}
          onDelete={onRangeDelete}
        />
      ) : (
        <div className="budget-month-panel" role="tabpanel">
      <div className="budget-month-nav">
        <button
          type="button"
          className="icon-button icon-button--small"
          onClick={() => setSelectedMonth((current) => shiftMonth(current, -1))}
          aria-label="上个月"
          title="上个月"
        >
          <ChevronLeft size={17} />
        </button>
        <div className="budget-month-copy">
          <strong>{monthLabel(selectedMonth)}</strong>
          <small>{sourceNote}</small>
        </div>
        <button
          type="button"
          className="icon-button icon-button--small"
          onClick={() => setSelectedMonth((current) => shiftMonth(current, 1))}
          aria-label="下个月"
          title="下个月"
        >
          <ChevronRight size={17} />
        </button>
        {selectedMonth !== currentMonthKey() ? (
          <button
            type="button"
            className="budget-month-today"
            onClick={() => setSelectedMonth(currentMonthKey())}
          >
            回到本月
          </button>
        ) : null}
      </div>

      {adjustments.length > 0 ? (
        <div className="budget-adjust-history">
          <div className="budget-adjust-history-head">
            <span>
              原定 {formatMoney(baseAmountCents / 100)} · 当前{' '}
              {formatMoney(resolved.budget.amountCents / 100)}
            </span>
            <em>{adjustments.length} 次调整</em>
          </div>
          <ul>
            {[...adjustments].reverse().map((entry) => (
              <li key={entry.id}>
                <span className="budget-adjust-time">
                  {formatAdjustmentTime(entry.at)}
                </span>
                <span className="budget-adjust-flow">
                  {formatMoney(entry.beforeCents / 100, false)} →{' '}
                  {formatMoney(entry.afterCents / 100, false)}
                </span>
                <em className={entry.deltaCents > 0 ? 'is-up' : 'is-down'}>
                  {entry.deltaCents > 0 ? '上调' : '下调'}{' '}
                  {formatMoney(Math.abs(entry.deltaCents) / 100, false)}
                </em>
                <small>
                  {entry.note || '未填写原因'}
                  {entry.kind === 'replan' ? ' · 重新制定' : ''}
                </small>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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

      <form className="budget-plan-form" onSubmit={handleSubmit}>
        <section className="budget-block">
          <div className="budget-block-head">
            <div>
              <h4>月度预算</h4>
              <p>
                每个月都可以有自己的数字。项目支出单独归集，不占这里的生活预算。
              </p>
            </div>
          </div>
          <p className="budget-base-line">
            原定预算 <strong>{formatMoney(baseAmountCents / 100)}</strong>
            {adjustments.length > 0 ? (
              <>
                {' · '}当前生效{' '}
                <strong>{formatMoney(resolved.budget.amountCents / 100)}</strong>
              </>
            ) : null}
          </p>
          <label className="budget-input budget-input--wide">
            <span>{symbol}</span>
            <input
              type="number"
              inputMode="decimal"
              min="0.01"
              step="0.01"
              value={draft.amount}
              onChange={(event) => {
                setDraft((current) => ({
                  ...current,
                  amount: event.target.value,
                }))
                setError('')
              }}
              placeholder="0.00"
              aria-label="月度预算金额"
            />
          </label>
          <p className="budget-mode-note">
            这里修改的是原定预算，不需要填写原因，保存后当前预算也会变为这个金额。只想临时上调或下调时，请回到概览使用「调整本月预算」，原定预算会保持不变并留下记录。
          </p>
        </section>

        <section className="budget-block">
          <div className="budget-block-head">
            <div>
              <h4>每日预算</h4>
              <p>
                自动均分会随实际花费和剩余天数调整每日额度；手动自定义则由你决定每一天的额度。
              </p>
            </div>
          </div>

          <div
            className="budget-mode-switch"
            role="radiogroup"
            aria-label="每日预算方式"
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
                    setDraft((current) => ({
                      ...current,
                      mode: option.id,
                    }))
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
              关闭后只按整月查看进度；打开后概览会显示今天的额度和超支预警。
            </p>
          ) : null}

          {draft.mode === 'auto' ? (
            <div className="budget-auto-preview">
              <div>
                <span>月均分</span>
                <strong>
                  {daily ? formatMoney(daily.baseDailyCents / 100) : '—'}
                </strong>
              </div>
              {isCurrentMonth(selectedMonth) && daily ? (
                <>
                  <div>
                    <span>今日额度</span>
                    <strong>{formatMoney(daily.todayBudgetCents / 100)}</strong>
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
                        ? '月底收拢'
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
                      {manualMismatchCents > 0 ? '高于' : '低于'}月预算{' '}
                      {formatMoney(Math.abs(manualMismatchCents) / 100)}
                    </em>
                  ) : null}
                </span>
                <div className="budget-manual-actions">
                  <button
                    type="button"
                    className="budget-quick-action"
                    onClick={distributeWholeMonth}
                  >
                    按整月均分
                  </button>
                  {isCurrentMonth(selectedMonth) ? (
                    <button
                      type="button"
                      className="budget-quick-action"
                      onClick={distributeRemaining}
                    >
                      按剩余重排
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="budget-quick-action"
                    onClick={alignDailyToMonth}
                  >
                    对齐月预算
                  </button>
                </div>
              </div>

              <div className="daily-input-grid">
                {Array.from({ length: dayCount }, (_, index) => {
                  const day = index + 1
                  const isToday =
                    isCurrentMonth(selectedMonth) &&
                    new Date().getDate() === day
                  const spentCents =
                    daily?.days[day - 1]?.spentCents ?? 0
                  return (
                    <label
                      key={day}
                      className={`daily-input${isToday ? ' is-today' : ''}`}
                    >
                      <span>
                        {day}日
                        {spentCents > 0 ? (
                          <small>{formatMoney(spentCents / 100, false)}</small>
                        ) : null}
                      </span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={draft.daily[String(day)] ?? ''}
                        onChange={(event) =>
                          updateDaily(day, event.target.value)
                        }
                        aria-label={`${day}日预算`}
                      />
                    </label>
                  )
                })}
              </div>

              <p className="budget-mode-note">
                手动额度不会因为当天超支而自动改写；可随时用「按剩余重排」把剩余月预算重新分给后续日期。
              </p>
            </div>
          ) : null}
        </section>

        <section className="budget-block">
          <div className="budget-block-head">
            <div>
              <h4>分类预算</h4>
              <p>
                可以只给关心的分类设上限，小分类的支出会自动归入大分类。留空表示不单独设限。
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
                      {capCents !== undefined
                        ? ` · 日均约 ${formatMoney(capCents / 100 / dayCount)}`
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
                  {unallocatedCents >= 0 ? ' · 未分配 ' : ' · 超出月预算 '}
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
            保存预算
          </button>
          <span>
            只保存 {monthLabel(selectedMonth)} 的预算
            {preview ? ` · 已用 ${formatPercent(preview.ratio * 100)}` : ''}
          </span>
        </div>
      </form>
        </div>
      )}
    </div>
  )
}
