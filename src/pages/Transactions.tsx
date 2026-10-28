import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  CalendarRange,
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Wallet,
} from 'lucide-react'
import { CategoryIcon } from '../components/CategoryIcon'
import { EmptyLedger } from '../components/EmptyLedger'
import { PendingCaptureCard } from '../components/PendingCaptureCard'
import { SelectMenu } from '../components/SelectMenu'
import { TransactionRow } from '../components/TransactionRow'
import type { PendingCapture } from '../lib/capture/types'
import { getCategoryPathName } from '../lib/categories'
import { expenseDeltaCents } from '../lib/refunds'
import {
  filterTransactions,
  hasActiveFilters,
  hasGlobalScope,
} from '../lib/search'
import {
  formatDayHeading,
  formatMoney,
  formatSignedMoney,
  getMonthTransactions,
  getTotals,
  monthLabel,
} from '../lib/utils'
import type {
  Account,
  Category,
  LedgerTransaction,
  Project,
  TransactionType,
} from '../types'

interface TransactionsProps {
  transactions: LedgerTransaction[]
  projects: Project[]
  categories: Category[]
  accounts: Account[]
  monthKey: string
  pendingCaptures: PendingCapture[]
  onAdd: () => void
  onEdit: (transaction: LedgerTransaction) => void
  onDelete: (id: string) => void
  onAnnotateCapture: (item: PendingCapture) => void
  onIgnoreCapture: (id: string) => void
  onLoadSample: () => void
}

type TypeFilter = 'all' | TransactionType

interface PopoverPosition {
  left: number
  top: number
  width: number
  maxHeight: number
}

/**
 * The filter sits at the right edge of the filter bar, so an anchored popover
 * would run off-screen. Measure the trigger and clamp the panel into the
 * viewport instead.
 */
function measurePopover(
  element: HTMLElement | null,
  width = 272,
): PopoverPosition | null {
  const trigger = element?.getBoundingClientRect()
  if (!trigger) return null
  const gutter = 12
  const clampedWidth = Math.min(width, window.innerWidth - gutter * 2)
  const left = Math.min(
    Math.max(gutter, trigger.right - clampedWidth),
    window.innerWidth - clampedWidth - gutter,
  )
  const top = trigger.bottom + 7
  const maxHeight = Math.max(
    180,
    Math.min(360, window.innerHeight - top - gutter),
  )
  return { left, top, width: clampedWidth, maxHeight }
}

function groupByDay(
  items: LedgerTransaction[],
): Array<[string, LedgerTransaction[]]> {
  const groups = new Map<string, LedgerTransaction[]>()
  for (const item of items) {
    const list = groups.get(item.date) ?? []
    list.push(item)
    groups.set(item.date, list)
  }
  return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a))
}

export function Transactions({
  transactions,
  projects,
  categories,
  accounts,
  monthKey,
  pendingCaptures,
  onAdd,
  onEdit,
  onDelete,
  onAnnotateCapture,
  onIgnoreCapture,
  onLoadSample,
}: TransactionsProps) {
  const [query, setQuery] = useState('')
  const [rangeStart, setRangeStart] = useState('')
  const [rangeEnd, setRangeEnd] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const [categoryMenuPosition, setCategoryMenuPosition] =
    useState<PopoverPosition | null>(null)
  const [expandedFilterIds, setExpandedFilterIds] = useState<Set<string>>(
    new Set(),
  )
  const categoryMenuRef = useRef<HTMLDivElement>(null)
  const categoryPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery('')
    setRangeStart('')
    setRangeEnd('')
    setTypeFilter('all')
    setCategoryFilter('')
    setAccountFilter('')
    setCategoryMenuOpen(false)
    setExpandedFilterIds(new Set())
  }, [monthKey])

  const monthTransactions = useMemo(
    () => getMonthTransactions(transactions, monthKey),
    [transactions, monthKey],
  )
  const isGlobal = hasGlobalScope({
    query,
    startDate: rangeStart,
    endDate: rangeEnd,
  })
  const rangeInvalid =
    rangeStart !== '' && rangeEnd !== '' && rangeStart > rangeEnd

  const categoryTree = useMemo(() => {
    const scoped =
      typeFilter === 'all'
        ? categories
        : categories.filter((category) => category.type === typeFilter)
    return scoped
      .filter((category) => !category.parentId)
      .map((parent) => ({
        parent,
        children: scoped.filter(
          (category) => category.parentId === parent.id,
        ),
      }))
  }, [categories, typeFilter])

  const expenseTree = useMemo(
    () => categoryTree.filter(({ parent }) => parent.type === 'expense'),
    [categoryTree],
  )
  const incomeTree = useMemo(
    () => categoryTree.filter(({ parent }) => parent.type === 'income'),
    [categoryTree],
  )

  const positionCategoryMenu = () => {
    setCategoryMenuPosition(measurePopover(categoryMenuRef.current))
  }

  const toggleCategoryMenu = () => {
    setCategoryMenuOpen((current) => {
      const next = !current
      if (next) positionCategoryMenu()
      return next
    })
  }

  useEffect(() => {
    if (!categoryMenuOpen) return
    const closeOnOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        !categoryMenuRef.current?.contains(target) &&
        !categoryPopoverRef.current?.contains(target)
      ) {
        setCategoryMenuOpen(false)
      }
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setCategoryMenuOpen(false)
    }
    const reposition = () => {
      if (categoryMenuOpen) positionCategoryMenu()
    }
    document.addEventListener('mousedown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    window.addEventListener('resize', reposition)
    window.addEventListener('scroll', reposition, true)
    return () => {
      document.removeEventListener('mousedown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
      window.removeEventListener('resize', reposition)
      window.removeEventListener('scroll', reposition, true)
    }
  }, [categoryMenuOpen])

  useEffect(() => {
    if (!categoryFilter) return
    const selected = categories.find(
      (category) => category.id === categoryFilter,
    )
    if (
      !selected ||
      (typeFilter !== 'all' && selected.type !== typeFilter)
    ) {
      setCategoryFilter('')
    }
  }, [categories, categoryFilter, typeFilter])

  useEffect(() => {
    if (!accountFilter) return
    if (!accounts.some((account) => account.id === accountFilter)) {
      setAccountFilter('')
    }
  }, [accounts, accountFilter])

  const filtered = useMemo(
    () =>
      filterTransactions(
        isGlobal ? transactions : monthTransactions,
        {
          query,
          type: typeFilter,
          categoryId: categoryFilter,
          accountId: accountFilter,
          startDate: rangeStart,
          endDate: rangeEnd,
        },
        categories,
        accounts,
        projects,
      ),
    [
      transactions,
      monthTransactions,
      isGlobal,
      query,
      typeFilter,
      categoryFilter,
      accountFilter,
      rangeStart,
      rangeEnd,
      categories,
      accounts,
      projects,
    ],
  )

  const summaryTransactions = isGlobal ? filtered : monthTransactions
  const summaryTotals = useMemo(
    () => getTotals(summaryTransactions),
    [summaryTransactions],
  )

  const monthGroups = useMemo(() => {
    if (!isGlobal) return []
    const months = new Map<string, LedgerTransaction[]>()
    for (const item of filtered) {
      const key = item.date.slice(0, 7)
      const list = months.get(key) ?? []
      list.push(item)
      months.set(key, list)
    }
    return [...months.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, items]) => ({ month, items, totals: getTotals(items) }))
  }, [filtered, isGlobal])

  const hasFilters = hasActiveFilters({
    query,
    type: typeFilter,
    categoryId: categoryFilter,
    accountId: accountFilter,
    startDate: rangeStart,
    endDate: rangeEnd,
  })

  const resetFilters = () => {
    setQuery('')
    setRangeStart('')
    setRangeEnd('')
    setTypeFilter('all')
    setCategoryFilter('')
    setAccountFilter('')
    setCategoryMenuOpen(false)
    setExpandedFilterIds(new Set())
  }

  const clearGlobalScope = () => {
    setQuery('')
    setRangeStart('')
    setRangeEnd('')
  }

  const globalScopeLabel =
    rangeStart || rangeEnd
      ? `${rangeStart || '最早'} 至 ${rangeEnd || '最新'}`
      : '全部月份'

  const handleTypeFilter = (next: TypeFilter) => {
    setTypeFilter(next)
    setCategoryMenuOpen(false)
    setExpandedFilterIds(new Set())
    if (next !== 'all' && categoryFilter) {
      const valid = categories.some(
        (category) =>
          category.id === categoryFilter && category.type === next,
      )
      if (!valid) setCategoryFilter('')
    }
  }

  const selectedFilterCategory = categoryFilter
    ? categories.find((category) => category.id === categoryFilter)
    : undefined
  const categoryFilterLabel = selectedFilterCategory
    ? getCategoryPathName(selectedFilterCategory)
    : '全部分类'
  const accountOptions = useMemo(() => {
    const wallet = accounts
      .filter((account) => account.type !== 'bank')
      .map((account) => ({
        value: account.id,
        label: account.name,
        group: '常用账户',
      }))
    const cards = accounts
      .filter((account) => account.type === 'bank')
      .map((account) => ({
        value: account.id,
        label: account.name,
        group: '银行卡',
      }))
    return [...wallet, ...cards]
  }, [accounts])

  const toggleFilterExpanded = (id: string) => {
    setExpandedFilterIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const pickCategoryFilter = (id: string) => {
    setCategoryFilter(id)
    setCategoryMenuOpen(false)
  }

  const renderCategoryFilterTree = (
    label: string | null,
    nodes: typeof categoryTree,
  ) => (
    <div className="category-filter-section">
      {label ? (
        <p className="category-filter-label">{label}</p>
      ) : null}
      {nodes.map(({ parent, children }) => {
        const expanded = expandedFilterIds.has(parent.id)
        return (
          <div className="category-filter-group" key={parent.id}>
            <div className="category-filter-row">
              <button
                type="button"
                className={`category-filter-option${
                  categoryFilter === parent.id ? ' is-selected' : ''
                }`}
                onClick={() => pickCategoryFilter(parent.id)}
                aria-pressed={categoryFilter === parent.id}
              >
                <CategoryIcon category={parent} size={16} />
                <span>{parent.name}</span>
                {categoryFilter === parent.id ? (
                  <Check size={12} className="category-filter-check" />
                ) : null}
              </button>
              {children.length > 0 ? (
                <button
                  type="button"
                  className="category-filter-expand"
                  onClick={() => toggleFilterExpanded(parent.id)}
                  aria-expanded={expanded}
                  aria-label={`${expanded ? '收起' : '展开'}${
                    parent.name
                  }的小分类`}
                  title={expanded ? '收起小分类' : '展开小分类'}
                >
                  <ChevronRight
                    size={14}
                    className={expanded ? 'is-expanded' : undefined}
                  />
                </button>
              ) : null}
            </div>
            {expanded
              ? children.map((child) => (
                  <button
                    key={child.id}
                    type="button"
                    className={`category-filter-option category-filter-option--child${
                      categoryFilter === child.id ? ' is-selected' : ''
                    }`}
                    onClick={() => pickCategoryFilter(child.id)}
                    aria-pressed={categoryFilter === child.id}
                  >
                    <CategoryIcon category={child} size={14} />
                    <span>{child.name}</span>
                    {categoryFilter === child.id ? (
                      <Check size={12} className="category-filter-check" />
                    ) : null}
                  </button>
                ))
              : null}
          </div>
        )
      })}
    </div>
  )

  const renderDayGroups = (items: LedgerTransaction[]) => (
    <div className="day-groups">
      {groupByDay(items).map(([date, dayItems]) => {
        const dayExpense = dayItems
          .filter((item) => item.type === 'expense')
          .reduce((sum, item) => sum + expenseDeltaCents(item), 0) / 100
        const dayIncome = dayItems
          .filter((item) => item.type === 'income')
          .reduce((sum, item) => sum + item.amountCents, 0) / 100
        return (
          <section className="day-group" key={date}>
            <header className="day-heading">
              <div>
                <h2>{formatDayHeading(date)}</h2>
                <span>{dayItems.length} 笔</span>
              </div>
              <div className="day-total">
                {dayExpense > 0 ? (
                  <span>支出 {formatMoney(dayExpense)}</span>
                ) : null}
                {dayIncome > 0 ? (
                  <span className="is-income">
                    收入 {formatMoney(dayIncome)}
                  </span>
                ) : null}
              </div>
            </header>
            <div className="card day-card">
              {dayItems.map((transaction) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                  projects={projects}
                  onEdit={onEdit}
                  onDelete={onDelete}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )

  if (transactions.length === 0) {
    return (
      <div className="page-stack transactions-page">
        <PendingCaptureCard
          items={pendingCaptures}
          onAnnotate={onAnnotateCapture}
          onIgnore={onIgnoreCapture}
        />
        <EmptyLedger onAdd={onAdd} onLoadSample={onLoadSample} />
      </div>
    )
  }

  return (
    <div className="page-stack transactions-page">
      <PendingCaptureCard
        items={pendingCaptures}
        onAnnotate={onAnnotateCapture}
        onIgnore={onIgnoreCapture}
      />

      <section
        className="card global-search-panel"
        aria-label="全局搜索与日期范围"
      >
        <label className="search-box global-search-box">
          <Search size={16} aria-hidden />
          <span className="sr-only">在所有月份中搜索流水</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索备注、金额、分类、账户或项目"
          />
        </label>

        <div
          className={`date-range${rangeInvalid ? ' is-invalid' : ''}`}
          role="group"
          aria-label="日期范围"
        >
          <CalendarRange size={15} aria-hidden />
          <label className="date-range-field">
            <span className="date-range-label">开始</span>
            <input
              type="date"
              value={rangeStart}
              max={rangeEnd || undefined}
              onChange={(event) => setRangeStart(event.target.value)}
              aria-label="开始日期"
            />
          </label>
          <span className="date-range-sep" aria-hidden>
            至
          </span>
          <label className="date-range-field">
            <span className="date-range-label">结束</span>
            <input
              type="date"
              value={rangeEnd}
              min={rangeStart || undefined}
              onChange={(event) => setRangeEnd(event.target.value)}
              aria-label="结束日期"
            />
          </label>
        </div>

        {isGlobal ? (
          <div className="global-scope">
            <span>
              {rangeStart || rangeEnd
                ? `范围：${globalScopeLabel}`
                : '正在全部月份中查找'}
              {query.trim() ? ' · 关键词' : ''}
            </span>
            <button
              type="button"
              className="button ghost global-scope-exit"
              onClick={clearGlobalScope}
            >
              返回按月查看
            </button>
          </div>
        ) : null}
      </section>

      {rangeInvalid ? (
        <p className="global-search-warning" role="alert">
          结束日期不能早于开始日期
        </p>
      ) : null}

      <section
        className="card ledger-summary"
        aria-label={isGlobal ? '筛选结果摘要' : '本月流水摘要'}
      >
        <div className="summary-cell">
          <span>{isGlobal ? '合计收入' : '本月收入'}</span>
          <strong className="is-income">
            {formatMoney(summaryTotals.income)}
          </strong>
        </div>
        <div className="summary-cell">
          <span>{isGlobal ? '合计支出' : '本月支出'}</span>
          <strong>{formatMoney(summaryTotals.expense)}</strong>
        </div>
        <div className="summary-cell">
          <span>{isGlobal ? '合计结余' : '本月结余'}</span>
          <strong
            className={summaryTotals.balance < 0 ? 'is-negative' : ''}
          >
            {formatSignedMoney(summaryTotals.balance)}
          </strong>
        </div>
        <div className="summary-cell summary-cell--count">
          <span>{isGlobal ? '结果' : '记录'}</span>
          <strong>{summaryTransactions.length} 笔</strong>
        </div>
      </section>

      <section className="card filter-panel" aria-label="筛选流水">
        <div className="filter-row">
          <div className="type-filter" role="group" aria-label="收支类型">
            {(
              [
                ['all', '全部'],
                ['expense', '支出'],
                ['income', '收入'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                className={typeFilter === value ? 'is-active' : ''}
                onClick={() => handleTypeFilter(value)}
                aria-pressed={typeFilter === value}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="select-field category-filter" ref={categoryMenuRef}>
            <SlidersHorizontal size={15} aria-hidden />
            <button
              type="button"
              className="category-filter-trigger"
              onClick={toggleCategoryMenu}
              aria-haspopup="dialog"
              aria-expanded={categoryMenuOpen}
              aria-label={`筛选分类：${categoryFilterLabel}`}
            >
              <span>{categoryFilterLabel}</span>
              <ChevronDown
                size={13}
                aria-hidden
                className={categoryMenuOpen ? 'is-open' : undefined}
              />
            </button>

            {categoryMenuOpen && categoryMenuPosition
              ? createPortal(
                  <div
                    className="category-filter-popover"
                    role="dialog"
                    aria-label="选择分类"
                    ref={categoryPopoverRef}
                    style={{
                      left: categoryMenuPosition.left,
                      top: categoryMenuPosition.top,
                      width: categoryMenuPosition.width,
                      maxHeight: categoryMenuPosition.maxHeight,
                    }}
                  >
                    <button
                      type="button"
                      className={`category-filter-option category-filter-option--all${
                        categoryFilter === '' ? ' is-selected' : ''
                      }`}
                      onClick={() => pickCategoryFilter('')}
                      aria-pressed={categoryFilter === ''}
                    >
                      <span>全部分类</span>
                      {categoryFilter === '' ? (
                        <Check size={12} className="category-filter-check" />
                      ) : null}
                    </button>

                    {typeFilter === 'all' ? (
                      <>
                        {expenseTree.length > 0
                          ? renderCategoryFilterTree('支出', expenseTree)
                          : null}
                        {incomeTree.length > 0
                          ? renderCategoryFilterTree('收入', incomeTree)
                          : null}
                      </>
                    ) : (
                      renderCategoryFilterTree(null, categoryTree)
                    )}
                  </div>,
                  document.body,
                )
              : null}
          </div>

          <SelectMenu
            value={accountFilter}
            options={accountOptions}
            onChange={setAccountFilter}
            ariaLabel="筛选账户"
            placeholder="全部账户"
            allLabel="全部账户"
            icon={<Wallet size={15} aria-hidden />}
            className="account-filter"
          />

          {hasFilters ? (
            <button
              type="button"
              className="button ghost filter-reset"
              onClick={resetFilters}
            >
              <RotateCcw size={14} />
              重置
            </button>
          ) : null}
        </div>
      </section>

      <div className="result-meta">
        <span>
          {isGlobal
            ? `${globalScopeLabel} · ${query.trim() ? '搜索结果' : '筛选结果'}`
            : `${monthLabel(monthKey)} · ${hasFilters ? '筛选结果' : '全部流水'}`}
        </span>
        <span>共 {filtered.length} 笔</span>
      </div>

      {filtered.length === 0 ? (
        <section className="card empty-state">
          <div className="empty-mark" aria-hidden="true">
            <Search size={22} />
          </div>
          <h2>
            {hasFilters ? '没有找到符合条件的流水' : '这个月的账页还是空白'}
          </h2>
          <p>
            {isGlobal
              ? '换个关键词或日期范围再试试。'
              : hasFilters
                ? '换一个关键词，或清空筛选再看看。'
                : '从一笔早餐、一趟地铁开始，账本就有了生活的形状。'}
          </p>
          {hasFilters ? (
            <button type="button" className="button secondary" onClick={resetFilters}>
              清空筛选
            </button>
          ) : (
            <button type="button" className="button primary" onClick={onAdd}>
              <Plus size={16} />
              记下第一笔
            </button>
          )}
        </section>
      ) : isGlobal ? (
        <div className="month-groups">
          {monthGroups.map((group) => (
            <section className="month-group" key={group.month}>
              <header className="month-heading">
                <div>
                  <h2>{monthLabel(group.month)}</h2>
                  <span>{group.items.length} 笔</span>
                </div>
                <div className="day-total">
                  {group.totals.expense > 0 ? (
                    <span>支出 {formatMoney(group.totals.expense)}</span>
                  ) : null}
                  {group.totals.income > 0 ? (
                    <span className="is-income">
                      收入 {formatMoney(group.totals.income)}
                    </span>
                  ) : null}
                </div>
              </header>
              {renderDayGroups(group.items)}
            </section>
          ))}
        </div>
      ) : (
        renderDayGroups(filtered)
      )}
    </div>
  )
}
