import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { CategoryIcon } from '../components/CategoryIcon'
import { EmptyLedger } from '../components/EmptyLedger'
import { TransactionRow } from '../components/TransactionRow'
import { ACCOUNTS } from '../lib/data'
import {
  getCategory,
  getCategoryPathName,
} from '../lib/categories'
import {
  formatDayHeading,
  formatMoney,
  formatSignedMoney,
  getMonthTransactions,
  getTotals,
  monthLabel,
} from '../lib/utils'
import type {
  Category,
  LedgerTransaction,
  Project,
  TransactionType,
} from '../types'

interface TransactionsProps {
  transactions: LedgerTransaction[]
  projects: Project[]
  categories: Category[]
  monthKey: string
  onAdd: () => void
  onEdit: (transaction: LedgerTransaction) => void
  onDelete: (id: string) => void
  onLoadSample: () => void
}

type TypeFilter = 'all' | TransactionType

export function Transactions({
  transactions,
  projects,
  categories,
  monthKey,
  onAdd,
  onEdit,
  onDelete,
  onLoadSample,
}: TransactionsProps) {
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [accountFilter, setAccountFilter] = useState('')
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  // The filter sits at the right edge of the filter bar, so an anchored
  // popover would run off-screen. Measure the trigger and clamp the panel
  // into the viewport instead.
  const [categoryMenuPosition, setCategoryMenuPosition] = useState<{
    left: number
    top: number
    width: number
    maxHeight: number
  } | null>(null)
  const [expandedFilterIds, setExpandedFilterIds] = useState<Set<string>>(
    new Set(),
  )
  const categoryMenuRef = useRef<HTMLDivElement>(null)
  const categoryPopoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery('')
    setTypeFilter('all')
    setCategoryFilter('')
    setAccountFilter('')
    setCategoryMenuOpen(false)
    setExpandedFilterIds(new Set())
  }, [monthKey])

  const monthTransactions = getMonthTransactions(transactions, monthKey)
  const totals = getTotals(monthTransactions)

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
    const trigger = categoryMenuRef.current?.getBoundingClientRect()
    if (!trigger) return
    const gutter = 12
    const width = Math.min(272, window.innerWidth - gutter * 2)
    const left = Math.min(
      Math.max(gutter, trigger.right - width),
      window.innerWidth - width - gutter,
    )
    const top = trigger.bottom + 7
    const maxHeight = Math.max(
      180,
      Math.min(360, window.innerHeight - top - gutter),
    )
    setCategoryMenuPosition({ left, top, width, maxHeight })
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
      if (event.key === 'Escape') setCategoryMenuOpen(false)
    }
    const reposition = () => positionCategoryMenu()
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

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const selectedCategory = categoryFilter
      ? categories.find((category) => category.id === categoryFilter)
      : undefined
    return monthTransactions.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false
      if (selectedCategory) {
        const itemCategory = categories.find(
          (category) => category.id === item.categoryId,
        )
        // Picking a big category includes everything filed under it.
        const matchesParent =
          !selectedCategory.parentId &&
          itemCategory?.parentId === selectedCategory.id
        if (
          item.categoryId !== selectedCategory.id &&
          !matchesParent
        ) {
          return false
        }
      }
      if (accountFilter && item.accountId !== accountFilter) return false
      if (normalizedQuery) {
        const category = getCategory(item.categoryId, item.type)
        const haystack = `${category.name} ${getCategoryPathName(category)} ${item.note}`.toLowerCase()
        if (!haystack.includes(normalizedQuery)) return false
      }
      return true
    })
  }, [
    monthTransactions,
    query,
    typeFilter,
    categoryFilter,
    accountFilter,
    categories,
  ])

  const grouped = useMemo(() => {
    const groups = new Map<string, LedgerTransaction[]>()
    for (const item of filtered) {
      const list = groups.get(item.date) ?? []
      list.push(item)
      groups.set(item.date, list)
    }
    return [...groups.entries()].sort(([a], [b]) => b.localeCompare(a))
  }, [filtered])

  const hasFilters =
    query.trim() !== '' ||
    typeFilter !== 'all' ||
    categoryFilter !== '' ||
    accountFilter !== ''

  const resetFilters = () => {
    setQuery('')
    setTypeFilter('all')
    setCategoryFilter('')
    setAccountFilter('')
    setCategoryMenuOpen(false)
    setExpandedFilterIds(new Set())
  }

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

  if (transactions.length === 0) {
    return (
      <div className="page-stack transactions-page">
        <EmptyLedger onAdd={onAdd} onLoadSample={onLoadSample} />
      </div>
    )
  }

  return (
    <div className="page-stack transactions-page">
      <section className="card ledger-summary" aria-label="本月流水摘要">
        <div className="summary-cell">
          <span>本月收入</span>
          <strong className="is-income">{formatMoney(totals.income)}</strong>
        </div>
        <div className="summary-cell">
          <span>本月支出</span>
          <strong>{formatMoney(totals.expense)}</strong>
        </div>
        <div className="summary-cell">
          <span>本月结余</span>
          <strong className={totals.balance < 0 ? 'is-negative' : ''}>
            {formatSignedMoney(totals.balance)}
          </strong>
        </div>
        <div className="summary-cell summary-cell--count">
          <span>记录</span>
          <strong>{monthTransactions.length} 笔</strong>
        </div>
      </section>

      <section className="card filter-panel" aria-label="筛选流水">
        <div className="filter-row">
          <label className="search-box">
            <Search size={16} aria-hidden />
            <span className="sr-only">搜索流水</span>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索备注或分类"
            />
          </label>

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

          <label className="select-field">
            <span className="sr-only">账户</span>
            <select
              value={accountFilter}
              onChange={(event) => setAccountFilter(event.target.value)}
            >
              <option value="">全部账户</option>
              {ACCOUNTS.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          </label>

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
          {monthLabel(monthKey)} · {hasFilters ? '筛选结果' : '全部流水'}
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
            {hasFilters
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
      ) : (
        <div className="day-groups">
          {grouped.map(([date, items]) => {
            const dayExpense = items
              .filter((item) => item.type === 'expense')
              .reduce((sum, item) => sum + item.amountCents, 0) / 100
            const dayIncome = items
              .filter((item) => item.type === 'income')
              .reduce((sum, item) => sum + item.amountCents, 0) / 100
            return (
              <section className="day-group" key={date}>
                <header className="day-heading">
                  <div>
                    <h2>{formatDayHeading(date)}</h2>
                    <span>{items.length} 笔</span>
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
                  {items.map((transaction) => (
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
      )}
    </div>
  )
}
