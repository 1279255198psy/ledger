import { useState } from 'react'
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import type { DailyDatum } from '../../types'
import {
  clamp,
  formatAxisNumber,
  formatMoney,
  formatMoneyCompact,
  monthLabel,
} from '../../lib/utils'
import { useElementWidth } from '../../lib/useElementWidth'
import { niceScale } from '../../lib/chartUtils'
import { ChartTable } from './ChartTable'

interface DailyExpenseChartProps {
  data: DailyDatum[]
  monthKey: string
}

const HEIGHT = 224
const MARGIN = { top: 28, right: 20, bottom: 30, left: 46 }

export function DailyExpenseChart({ data, monthKey }: DailyExpenseChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [activeIndex, setActiveIndex] = useState<number | null>(null)

  const maxValue = Math.max(0, ...data.map((item) => item.value))
  const { max, ticks } = niceScale(maxValue)
  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 40)
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const baseline = MARGIN.top + plotHeight
  const count = data.length
  const stepX = count > 1 ? plotWidth / (count - 1) : plotWidth

  const xFor = (index: number) => MARGIN.left + index * stepX
  const yFor = (value: number) =>
    baseline - (value / Math.max(max, 1)) * plotHeight

  const linePath = data
    .map(
      (item, index) =>
        `${index === 0 ? 'M' : 'L'} ${xFor(index)} ${yFor(item.value)}`,
    )
    .join(' ')
  const areaPath =
    count > 0
      ? `${linePath} L ${xFor(count - 1)} ${baseline} L ${xFor(0)} ${baseline} Z`
      : ''

  const activeDatum = activeIndex === null ? null : data[activeIndex]
  const activeX = activeIndex === null ? 0 : xFor(activeIndex)
  const activeY = activeDatum ? yFor(activeDatum.value) : 0
  const tooltipX =
    activeIndex === null
      ? 0
      : clamp(activeX, 88, Math.max(width - 88, 88))
  const isQuiet = maxValue === 0

  const labelIndexes = Array.from(
    new Set([0, 7, 14, 21, count - 1].filter((index) => index >= 0 && index < count)),
  )

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    if (rect.width === 0) return
    const localX = ((event.clientX - rect.left) / rect.width) * width
    if (localX < MARGIN.left - 12 || localX > MARGIN.left + plotWidth + 12) {
      setActiveIndex(null)
      return
    }
    const index = Math.round((localX - MARGIN.left) / stepX)
    setActiveIndex(clamp(index, 0, Math.max(count - 1, 0)))
  }

  const handleKeyDown = (event: ReactKeyboardEvent<SVGSVGElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const current = activeIndex ?? count - 1
    const next = event.key === 'ArrowLeft' ? current - 1 : current + 1
    setActiveIndex(clamp(next, 0, Math.max(count - 1, 0)))
  }

  const lastDatum = data[count - 1]

  return (
    <div className="chart-block">
      <div className="chart-canvas" ref={ref}>
        <svg
          width={width}
          height={HEIGHT}
          className="daily-chart"
          tabIndex={0}
          role="img"
          aria-label={`${monthLabel(monthKey)}每日支出折线图，可使用左右方向键查看每天金额`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setActiveIndex(null)}
          onKeyDown={handleKeyDown}
          onFocus={() => {
            if (activeIndex === null) setActiveIndex(Math.max(count - 1, 0))
          }}
          onBlur={() => setActiveIndex(null)}
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

          {areaPath ? <path d={areaPath} className="daily-area" /> : null}
          {linePath ? <path d={linePath} className="daily-line" /> : null}

          {lastDatum && lastDatum.value > 0 ? (
            <circle
              cx={xFor(count - 1)}
              cy={yFor(lastDatum.value)}
              r={4.5}
              className="daily-end-dot"
            />
          ) : null}

          {lastDatum.value > 0 && activeIndex === null ? (
            <text
              x={xFor(count - 1)}
              y={yFor(lastDatum.value) - 11}
              textAnchor="end"
              className="chart-direct-label"
            >
              {formatMoneyCompact(lastDatum.value)}
            </text>
          ) : null}

          {activeDatum ? (
            <g>
              <line
                x1={activeX}
                x2={activeX}
                y1={MARGIN.top}
                y2={baseline}
                className="chart-crosshair"
              />
              <circle
                cx={activeX}
                cy={activeY}
                r={4.5}
                className="daily-active-dot"
              />
            </g>
          ) : null}

          {labelIndexes.map((index) => (
            <text
              key={index}
              x={xFor(index)}
              y={HEIGHT - 9}
              textAnchor={
                index === 0 ? 'start' : index === count - 1 ? 'end' : 'middle'
              }
              className="chart-x-label"
            >
              {data[index]?.day}日
            </text>
          ))}
        </svg>

        {activeDatum ? (
          <div
            className="chart-tooltip"
            style={{ left: `${tooltipX}px`, top: '0px' }}
            role="status"
          >
            <strong>{formatMoney(activeDatum.value)}</strong>
            <span className="chart-tooltip-label">
              <i className="tooltip-key series-trend" aria-hidden />
              {monthLabel(monthKey)} {activeDatum.day}日
            </span>
          </div>
        ) : null}

        {isQuiet ? (
          <p className="chart-empty-note">这个月还没有支出记录</p>
        ) : null}
      </div>

      <ChartTable
        label={`${monthLabel(monthKey)}每日支出`}
        columns={['日期', '支出']}
        rows={data.map((item) => [
          `${item.day}日`,
          item.value > 0 ? formatMoney(item.value) : '—',
        ])}
      />
    </div>
  )
}
