import { useState } from 'react'
import type { MonthPairDatum } from '../../types'
import {
  clamp,
  formatAxisNumber,
  formatMoney,
  monthLabel,
} from '../../lib/utils'
import { useElementWidth } from '../../lib/useElementWidth'
import { niceScale, topRoundedBarPath } from '../../lib/chartUtils'
import { ChartTable } from './ChartTable'

interface IncomeExpenseChartProps {
  data: MonthPairDatum[]
}

const HEIGHT = 260
const MARGIN = { top: 18, right: 16, bottom: 34, left: 48 }

function coverageText(item: MonthPairDatum): string {
  switch (item.coverage) {
    case 'first-partial':
      return `首月自 ${item.effectiveDays > 0 ? item.totalDays - item.effectiveDays + 1 : 1} 日起`
    case 'current':
      return `本月至今 ${item.effectiveDays}/${item.totalDays} 天`
    case 'future':
      return '尚未开始'
    case 'before-start':
      return '早于统计起点'
    case 'complete':
      return '完整月'
  }
}

export function IncomeExpenseChart({ data }: IncomeExpenseChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<number | null>(null)
  const [mode, setMode] = useState<'total' | 'daily'>('total')

  const valueOf = (item: MonthPairDatum) =>
    mode === 'daily'
      ? { income: item.dailyIncome, expense: item.dailyExpense }
      : { income: item.income, expense: item.expense }

  const maxValue = Math.max(
    0,
    ...data.map((item) => {
      const value = valueOf(item)
      return Math.max(value.income, value.expense)
    }),
  )
  const { max, ticks } = niceScale(maxValue)
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 40)
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const baseline = MARGIN.top + plotHeight
  const band = plotWidth / Math.max(data.length, 1)
  const gap = 2
  const barWidth = Math.min(18, Math.max(4, (band * 0.5 - gap) / 2))
  const groupWidth = barWidth * 2 + gap

  const yFor = (value: number) =>
    baseline - (value / Math.max(max, 1)) * plotHeight

  const hoveredDatum = hovered === null ? null : data[hovered]
  const tooltipX =
    hovered === null
      ? 0
      : clamp(
          MARGIN.left + band * hovered + band / 2,
          94,
          Math.max(width - 94, 94),
        )

  return (
    <div className="chart-block">
      <div className="chart-legend-row">
        <div className="chart-legend" aria-hidden="true">
          <span>
            <i className="legend-swatch series-income" />
            收入
          </span>
          <span>
            <i className="legend-swatch series-expense" />
            支出
          </span>
        </div>
        <div className="chart-toggle" role="group" aria-label="图表口径">
          <button
            type="button"
            className={mode === 'total' ? 'is-active' : ''}
            aria-pressed={mode === 'total'}
            onClick={() => setMode('total')}
          >
            总额
          </button>
          <button
            type="button"
            className={mode === 'daily' ? 'is-active' : ''}
            aria-pressed={mode === 'daily'}
            onClick={() => setMode('daily')}
          >
            日均
          </button>
        </div>
      </div>

      <div className="chart-canvas" ref={ref}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`近六个月收支对比柱状图，${mode === 'daily' ? '按日均' : '按总额'}，${data
            .map(
              (item) =>
                `${monthLabel(item.key)}收入${formatMoney(valueOf(item).income)}，支出${formatMoney(valueOf(item).expense)}，${coverageText(item)}`,
            )
            .join('；')}`}
        >
          {ticks.map((tick) => {
            const y = yFor(tick)
            return (
              <g key={tick}>
                <line
                  x1={MARGIN.left}
                  x2={MARGIN.left + plotWidth}
                  y1={y}
                  y2={y}
                  className={tick === 0 ? 'chart-baseline' : 'chart-gridline'}
                />
                <text
                  x={MARGIN.left - 10}
                  y={y + 3.5}
                  textAnchor="end"
                  className="chart-axis-label"
                >
                  {formatAxisNumber(tick)}
                </text>
              </g>
            )
          })}

          {data.map((item, index) => {
            const groupX =
              MARGIN.left + band * index + (band - groupWidth) / 2
            const value = valueOf(item)
            const incomeY = yFor(value.income)
            const expenseY = yFor(value.expense)
            const incomeHeight = baseline - incomeY
            const expenseHeight = baseline - expenseY
            const isHovered = hovered === index

            return (
              <g
                key={item.key}
                className="chart-bar-group"
                tabIndex={0}
                role="img"
                aria-label={`${monthLabel(item.key)}，收入 ${formatMoney(value.income)}，支出 ${formatMoney(value.expense)}，${coverageText(item)}`}
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered(null)}
                onFocus={() => setHovered(index)}
                onBlur={() => setHovered(null)}
              >
                {isHovered ? (
                  <rect
                    x={MARGIN.left + band * index + 2}
                    y={MARGIN.top - 8}
                    width={Math.max(band - 4, 2)}
                    height={plotHeight + 8}
                    rx={8}
                    className="chart-hover-band"
                  />
                ) : null}
                <rect
                  x={MARGIN.left + band * index}
                  y={MARGIN.top - 12}
                  width={band}
                  height={plotHeight + 16}
                  fill="transparent"
                />
                <path
                  d={topRoundedBarPath(
                    groupX,
                    incomeY,
                    barWidth,
                    incomeHeight,
                  )}
                  className="chart-bar series-income"
                />
                <path
                  d={topRoundedBarPath(
                    groupX + barWidth + gap,
                    expenseY,
                    barWidth,
                    expenseHeight,
                  )}
                  className="chart-bar series-expense"
                />
                <rect
                  x={groupX - 3}
                  y={MARGIN.top - 4}
                  width={groupWidth + 6}
                  height={plotHeight + 4}
                  rx={6}
                  className="chart-focus-ring"
                />
              </g>
            )
          })}

          {data.map((item, index) => {
            const partial = item.coverage !== 'complete'
            return (
              <g key={item.key}>
                {partial ? (
                  <circle
                    cx={MARGIN.left + band * index + band / 2 - 13}
                    cy={HEIGHT - 14}
                    r={2.5}
                    className="chart-partial-dot"
                  />
                ) : null}
                <text
                  x={MARGIN.left + band * index + band / 2}
                  y={HEIGHT - 10}
                  textAnchor="middle"
                  className={`chart-x-label${partial ? ' is-incomplete' : ''}`}
                >
                  {item.label}
                  {partial ? '*' : ''}
                </text>
              </g>
            )
          })}
        </svg>

        {hoveredDatum ? (
          <div
            className="chart-tooltip chart-tooltip--series"
            style={{ left: `${tooltipX}px`, top: '-2px' }}
            role="status"
          >
            <span className="chart-tooltip-month">
              {monthLabel(hoveredDatum.key)}
            </span>
            <span className="chart-tooltip-row">
              <strong>{formatMoney(valueOf(hoveredDatum).income)}</strong>
              <span>
                <i className="tooltip-key series-income" aria-hidden />
                收入{mode === 'daily' ? '/日' : ''}
              </span>
            </span>
            <span className="chart-tooltip-row">
              <strong>{formatMoney(valueOf(hoveredDatum).expense)}</strong>
              <span>
                <i className="tooltip-key series-expense" aria-hidden />
                支出{mode === 'daily' ? '/日' : ''}
              </span>
            </span>
            {hoveredDatum.coverage !== 'complete' ? (
              <span className="chart-tooltip-note">
                {coverageText(hoveredDatum)}
                {hoveredDatum.coverage === 'current' ? '，尚未结束' : ''}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>

      {data.some((item) => item.coverage !== 'complete') ? (
        <p className="chart-partial-hint">
          * 首月只统计覆盖天数，本月统计至今；切换到「日均」可直接比较。
        </p>
      ) : null}

      <ChartTable
        label={`近六个月收支（${mode === 'daily' ? '日均' : '总额'}）`}
        columns={['月份', '收入', '支出', '覆盖']}
        rows={data.map((item) => [
          monthLabel(item.key),
          formatMoney(valueOf(item).income),
          formatMoney(valueOf(item).expense),
          coverageText(item),
        ])}
      />
    </div>
  )
}
