import { useMemo, useState } from 'react'
import { PencilLine } from 'lucide-react'
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
  onAdjustOpeningBalance: () => void
}

export function BalanceSummary({
  transactions,
  monthKey,
  openingBalance,
  onAdjustOpeningBalance,
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

  // 总结余是账本的当前余额：起始资金加上每一个月的结余，不能只取
  // 选定区间。区间选择只改变下方「区间收入 / 支出 / 笔数」的统计。
  const allTotals = getTotals(transactions)
  const totals = getTotals(filtered)
  const total = openingBalance + allTotals.balance

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
            起始资金加上全部月份的收入与支出；下方切换区间统计
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
          <span className="balance-figure-label">当前总结余</span>
          <strong className={total < 0 ? 'is-negative' : ''}>
            {total < 0 ? '−' : ''}
            {formatMoney(Math.abs(total))}
          </strong>
          <p className="balance-formula">
            <span>起始资金 {formatMoney(openingBalance)}</span>
            <b aria-hidden="true">+</b>
            <span>累计收入 {formatMoney(allTotals.income)}</span>
            <b aria-hidden="true">−</b>
            <span>累计支出 {formatMoney(allTotals.expense)}</span>
          </p>
          <button
            type="button"
            className="text-link balance-edit"
            onClick={onAdjustOpeningBalance}
          >
            <PencilLine size={14} />
            {openingBalance > 0 ? '调整起始资金' : '设置起始资金'}
          </button>
        </div>

        <div className="balance-breakdown">
          <p className="balance-breakdown-label">区间统计 · {rangeLabel}</p>
          <div className="balance-cell">
            <span>起始资金</span>
            <strong>
              {openingBalance > 0 ? formatMoney(openingBalance) : '从零开始'}
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
