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

export function IncomeExpenseChart({ data }: IncomeExpenseChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<number | null>(null)

  const maxValue = Math.max(
    0,
    ...data.map((item) => Math.max(item.income, item.expense)),
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

      <div className="chart-canvas" ref={ref}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`近六个月收支对比柱状图，${data
            .map(
              (item) =>
                `${monthLabel(item.key)}收入${formatMoney(item.income)}，支出${formatMoney(item.expense)}`,
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
            const incomeY = yFor(item.income)
            const expenseY = yFor(item.expense)
            const incomeHeight = baseline - incomeY
            const expenseHeight = baseline - expenseY
            const isHovered = hovered === index

            return (
              <g
                key={item.key}
                className="chart-bar-group"
                tabIndex={0}
                role="img"
                aria-label={`${monthLabel(item.key)}，收入 ${formatMoney(item.income)}，支出 ${formatMoney(item.expense)}`}
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

          {data.map((item, index) => (
            <text
              key={item.key}
              x={MARGIN.left + band * index + band / 2}
              y={HEIGHT - 10}
              textAnchor="middle"
              className="chart-x-label"
            >
              {item.label}
            </text>
          ))}
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
              <strong>{formatMoney(hoveredDatum.income)}</strong>
              <span>
                <i className="tooltip-key series-income" aria-hidden />
                收入
              </span>
            </span>
            <span className="chart-tooltip-row">
              <strong>{formatMoney(hoveredDatum.expense)}</strong>
              <span>
                <i className="tooltip-key series-expense" aria-hidden />
                支出
              </span>
            </span>
          </div>
        ) : null}
      </div>

      <ChartTable
        label="近六个月收支"
        columns={['月份', '收入', '支出']}
        rows={data.map((item) => [
          monthLabel(item.key),
          formatMoney(item.income),
          formatMoney(item.expense),
        ])}
      />
    </div>
  )
}
