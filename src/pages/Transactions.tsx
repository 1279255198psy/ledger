import { useEffect, useMemo, useState } from 'react'
import {
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { EmptyLedger } from '../components/EmptyLedger'
import { TransactionRow } from '../components/TransactionRow'
import {
  ACCOUNTS,
  CATEGORIES,
  getCategoriesForType,
  getCategory,
} from '../lib/data'
import {
  formatDayHeading,
  formatMoney,
  formatSignedMoney,
  getMonthTransactions,
  getTotals,
  monthLabel,
} from '../lib/utils'
import type {
  LedgerTransaction,
  TransactionType,
} from '../types'

interface TransactionsProps {
  transactions: LedgerTransaction[]
  monthKey: string
  onAdd: () => void
  onEdit: (transaction: LedgerTransaction) => void
  onDelete: (id: string) => void
  onLoadSample: () => void
}

type TypeFilter = 'all' | TransactionType

export function Transactions({
  transactions,
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

  useEffect(() => {
    setQuery('')
    setTypeFilter('all')
    setCategoryFilter('')
    setAccountFilter('')
  }, [monthKey])

  const monthTransactions = getMonthTransactions(transactions, monthKey)
  const totals = getTotals(monthTransactions)

  const categoryOptions =
    typeFilter === 'all' ? CATEGORIES : getCategoriesForType(typeFilter)

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return monthTransactions.filter((item) => {
      if (typeFilter !== 'all' && item.type !== typeFilter) return false
      if (categoryFilter && item.categoryId !== categoryFilter) return false
      if (accountFilter && item.accountId !== accountFilter) return false
      if (normalizedQuery) {
        const haystack = `${getCategory(item.categoryId).name} ${item.note}`.toLowerCase()
        if (!haystack.includes(normalizedQuery)) return false
      }
      return true
    })
  }, [monthTransactions, query, typeFilter, categoryFilter, accountFilter])

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
  }

  const handleTypeFilter = (next: TypeFilter) => {
    setTypeFilter(next)
    if (next !== 'all' && categoryFilter) {
      const valid = getCategoriesForType(next).some(
        (category) => category.id === categoryFilter,
      )
      if (!valid) setCategoryFilter('')
    }
  }

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

          <label className="select-field">
            <SlidersHorizontal size={15} aria-hidden />
            <span className="sr-only">分类</span>
            <select
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="">全部分类</option>
              {categoryOptions.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

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
              .reduce((sum, item) => sum + item.amount, 0)
            const dayIncome = items
              .filter((item) => item.type === 'income')
              .reduce((sum, item) => sum + item.amount, 0)
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
