import { useState } from 'react'
import type { MonthDatum } from '../../types'
import {
  clamp,
  formatAxisNumber,
  formatMoney,
  formatMoneyCompact,
  monthLabel,
} from '../../lib/utils'
import { useElementWidth } from '../../lib/useElementWidth'
import { niceScale, topRoundedBarPath } from '../../lib/chartUtils'
import { ChartTable } from './ChartTable'

interface ExpenseTrendChartProps {
  data: MonthDatum[]
  activeKey: string
}

const HEIGHT = 238
const MARGIN = { top: 34, right: 16, bottom: 32, left: 46 }

export function ExpenseTrendChart({ data, activeKey }: ExpenseTrendChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<number | null>(null)

  const maxValue = Math.max(0, ...data.map((item) => item.value))
  const { max, ticks } = niceScale(maxValue)
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 40)
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const baseline = MARGIN.top + plotHeight
  const band = plotWidth / Math.max(data.length, 1)
  const barWidth = Math.min(24, band * 0.36)
  const activeIndex = data.findIndex((item) => item.key === activeKey)

  const xFor = (index: number) =>
    MARGIN.left + band * index + (band - barWidth) / 2
  const yFor = (value: number) =>
    baseline - (value / Math.max(max, 1)) * plotHeight

  const hoveredDatum = hovered === null ? null : data[hovered]
  const tooltipX =
    hovered === null
      ? 0
      : clamp(
          MARGIN.left + band * hovered + band / 2,
          82,
          Math.max(width - 82, 82),
        )

  const activeDatum = activeIndex >= 0 ? data[activeIndex] : null
  const isQuiet = maxValue === 0

  return (
    <div className="chart-block">
      <div className="chart-canvas" ref={ref}>
        <svg
          width={width}
          height={HEIGHT}
          role="img"
          aria-label={`近六个月支出柱状图，${data
            .map((item) => `${monthLabel(item.key)}${formatMoney(item.value)}`)
            .join('，')}`}
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
            const barX = xFor(index)
            const barY = yFor(item.value)
            const barHeight = baseline - barY
            const isHovered = hovered === index
            const isActive = index === activeIndex
            return (
              <g
                key={item.key}
                className="chart-bar-group"
                tabIndex={0}
                role="img"
                aria-label={`${monthLabel(item.key)}支出 ${formatMoney(item.value)}`}
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
                  y={MARGIN.top - 14}
                  width={band}
                  height={plotHeight + 18}
                  fill="transparent"
                />
                {barHeight > 0 ? (
                  <path
                    d={topRoundedBarPath(barX, barY, barWidth, barHeight)}
                    className="chart-bar chart-bar--trend"
                  />
                ) : (
                  <rect
                    x={barX}
                    y={baseline - 2}
                    width={barWidth}
                    height={2}
                    rx={1}
                    className="chart-bar chart-bar--zero"
                  />
                )}
                <rect
                  x={barX - 3}
                  y={Math.min(barY, baseline) - 4}
                  width={barWidth + 6}
                  height={Math.max(barHeight + 8, 8)}
                  rx={6}
                  className="chart-focus-ring"
                />
                {isActive && item.value > 0 ? (
                  <text
                    x={barX + barWidth / 2}
                    y={Math.max(barY - 9, MARGIN.top - 12)}
                    textAnchor="middle"
                    className="chart-direct-label"
                  >
                    {formatMoneyCompact(item.value)}
                  </text>
                ) : null}
              </g>
            )
          })}

          {data.map((item, index) => (
            <text
              key={item.key}
              x={MARGIN.left + band * index + band / 2}
              y={HEIGHT - 9}
              textAnchor="middle"
              className={`chart-x-label${item.key === activeKey ? ' is-active' : ''}`}
            >
              {item.label}
            </text>
          ))}

          {activeDatum && activeDatum.value === 0 ? (
            <text
              x={MARGIN.left + band * activeIndex + band / 2}
              y={baseline - 10}
              textAnchor="middle"
              className="chart-axis-label"
            >
              暂无
            </text>
          ) : null}
        </svg>

        {hoveredDatum ? (
          <div
            className="chart-tooltip"
            style={{ left: `${tooltipX}px`, top: '0px' }}
            role="status"
          >
            <strong>{formatMoney(hoveredDatum.value)}</strong>
            <span className="chart-tooltip-label">
              <i className="tooltip-key series-trend" aria-hidden />
              {monthLabel(hoveredDatum.key)}支出
            </span>
          </div>
        ) : null}

        {isQuiet ? (
          <p className="chart-empty-note">这段时间还没有支出记录</p>
        ) : null}
      </div>

      <ChartTable
        label="近六个月支出"
        columns={['月份', '支出']}
        rows={data.map((item) => [monthLabel(item.key), formatMoney(item.value)])}
      />
    </div>
  )
}
