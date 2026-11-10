import { useMemo, useState } from 'react'
import {
  formatMoney,
  getTotals,
  monthLabel,
  shiftMonth,
} from '../lib/utils'
import type { LedgerTransaction } from '../types'

type RangeMode = 'month' | 'recent6' | 'year' | 'all' | 'custom'

const RANGE_OPTIONS: Array<{ id: RangeMode; label: string }> = [
  { id: 'month', label: '本月' },
  { id: 'recent6', label: '近 6 个月' },
  { id: 'year', label: '今年' },
  { id: 'all', label: '全部' },
  { id: 'custom', label: '自定义' },
]

interface BalanceSummaryProps {
  transactions: LedgerTransaction[]
  monthKey: string
  openingBalance: number
}

export function BalanceSummary({
  transactions,
  monthKey,
  openingBalance,
}: BalanceSummaryProps) {
  const [mode, setMode] = useState<RangeMode>('month')
  const [customStart, setCustomStart] = useState(() =>
    shiftMonth(monthKey, -5),
  )
  const [customEnd, setCustomEnd] = useState(monthKey)

  let start = ''
  let end = ''
  if (mode === 'month') {
    start = monthKey
    end = monthKey
  } else if (mode === 'recent6') {
    start = shiftMonth(monthKey, -5)
    end = monthKey
  } else if (mode === 'year') {
    const year = monthKey.slice(0, 4)
    start = `${year}-01`
    end = `${year}-12`
  } else if (mode === 'custom') {
    start = customStart || monthKey
    end = customEnd || customStart || monthKey
    if (start > end) {
      const swap = start
      start = end
      end = swap
    }
  }

  const filtered = useMemo(
    () =>
      transactions.filter((transaction) => {
        const month = transaction.date.slice(0, 7)
        if (start && month < start) return false
        if (end && month > end) return false
        return true
      }),
    [transactions, start, end],
  )

  // 总结余跟着上方切换的月份走：起始资金 = 上个月的总结余（最早一个月
  // 就是设置的起始资金），再加上该月收支。区间选择只改变下方「区间收入 /
  // 支出 / 笔数」的统计，不影响总结余。
  const totalsBeforeMonth = useMemo(
    () =>
      getTotals(
        transactions.filter(
          (transaction) => transaction.date.slice(0, 7) < monthKey,
        ),
      ),
    [transactions, monthKey],
  )
  const totalsForMonth = useMemo(
    () =>
      getTotals(
        transactions.filter(
          (transaction) => transaction.date.slice(0, 7) === monthKey,
        ),
      ),
    [transactions, monthKey],
  )
  const totals = getTotals(filtered)
  const startingBalance = openingBalance + totalsBeforeMonth.balance
  const total = startingBalance + totalsForMonth.balance

  // 区间统计的期初结余：所选区间开始之前的累计结余；「全部」就是起始资金。
  const rangeOpeningBalance = useMemo(() => {
    if (!start) return openingBalance
    return (
      openingBalance +
      getTotals(
        transactions.filter(
          (transaction) => transaction.date.slice(0, 7) < start,
        ),
      ).balance
    )
  }, [transactions, openingBalance, start])

  let rangeLabel = '全部月份'
  if (mode === 'month') {
    rangeLabel = monthLabel(monthKey)
  } else if (mode === 'recent6') {
    rangeLabel = `${monthLabel(start)} – ${monthLabel(end)}`
  } else if (mode === 'year') {
    rangeLabel = `${monthKey.slice(0, 4)} 年全年`
  } else if (mode === 'custom') {
    rangeLabel =
      start === end
        ? monthLabel(start)
        : `${monthLabel(start)} – ${monthLabel(end)}`
  }

  const chooseMode = (next: RangeMode) => {
    if (next === 'custom' && mode !== 'custom') {
      if (!customStart) setCustomStart(shiftMonth(monthKey, -5))
      if (!customEnd) setCustomEnd(monthKey)
    }
    setMode(next)
  }

  return (
    <section className="card balance-card" aria-labelledby="balance-summary-heading">
      <div className="balance-card-head">
        <div>
          <p className="card-kicker">TOTAL BALANCE</p>
          <h2 id="balance-summary-heading">总结余</h2>
          <p className="card-sub">
            上月总结余加上该月收入与支出；下方切换区间统计
          </p>
        </div>
        <div className="balance-range" role="group" aria-label="区间统计范围">
          {RANGE_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              className={mode === option.id ? 'is-active' : ''}
              onClick={() => chooseMode(option.id)}
              aria-pressed={mode === option.id}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {mode === 'custom' ? (
        <div className="balance-range-custom">
          <label className="balance-month-field">
            <span>开始月份</span>
            <input
              type="month"
              value={customStart}
              onChange={(event) => {
                const value = event.target.value
                setCustomStart(value)
                if (value && customEnd && value > customEnd) {
                  setCustomEnd(value)
                }
              }}
            />
          </label>
          <span className="balance-range-dash" aria-hidden="true">
            —
          </span>
          <label className="balance-month-field">
            <span>结束月份</span>
            <input
              type="month"
              value={customEnd}
              onChange={(event) => {
                const value = event.target.value
                setCustomEnd(value)
                if (value && customStart && value < customStart) {
                  setCustomStart(value)
                }
              }}
            />
          </label>
        </div>
      ) : null}

      <div className="balance-body">
        <div className="balance-figure">
          <span className="balance-figure-label">
            {monthLabel(monthKey)} 总结余
          </span>
          <strong className={total < 0 ? 'is-negative' : ''}>
            {total < 0 ? '−' : ''}
            {formatMoney(Math.abs(total))}
          </strong>
          <p className="balance-formula">
            <span>
              上月总结余 {startingBalance < 0 ? '−' : ''}
              {formatMoney(Math.abs(startingBalance))}
            </span>
            <b aria-hidden="true">+</b>
            <span>该月收入 {formatMoney(totalsForMonth.income)}</span>
            <b aria-hidden="true">−</b>
            <span>该月支出 {formatMoney(totalsForMonth.expense)}</span>
          </p>
        </div>

        <div className="balance-breakdown">
          <p className="balance-breakdown-label">区间统计 · {rangeLabel}</p>
          <div className="balance-cell">
            <span>期初结余</span>
            <strong className={rangeOpeningBalance < 0 ? 'is-negative' : ''}>
              {rangeOpeningBalance < 0 ? '−' : ''}
              {formatMoney(Math.abs(rangeOpeningBalance))}
            </strong>
          </div>
          <div className="balance-cell">
            <span>区间收入</span>
            <strong className="is-income">
              +{formatMoney(totals.income)}
            </strong>
          </div>
          <div className="balance-cell">
            <span>区间支出</span>
            <strong className="is-expense">
              −{formatMoney(totals.expense)}
            </strong>
          </div>
          <div className="balance-cell">
            <span>区间笔数</span>
            <strong>{filtered.length} 笔</strong>
          </div>
        </div>
      </div>
    </section>
  )
}
