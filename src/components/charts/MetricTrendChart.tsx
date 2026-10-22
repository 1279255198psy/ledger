import { useId, useState } from 'react'
import type { IndexPoint } from '../../lib/health'
import { clamp } from '../../lib/utils'
import { useElementWidth } from '../../lib/useElementWidth'
import { ChartTable } from './ChartTable'

interface MetricTrendChartProps {
  points: IndexPoint[]
  formatValue: (value: number) => string
  formatTick: (value: number) => string
  allowNegative?: boolean
  color?: string
  emptyText?: string
  label: string
}

const HEIGHT = 118
const MARGIN = { top: 12, right: 8, bottom: 20, left: 38 }

interface PlotPoint {
  x: number
  y: number
  value: number
  index: number
}

export function MetricTrendChart({
  points,
  formatValue,
  formatTick,
  allowNegative = false,
  color = 'var(--accent)',
  emptyText = '暂无足够数据',
  label,
}: MetricTrendChartProps) {
  const { ref, width } = useElementWidth<HTMLDivElement>()
  const [hovered, setHovered] = useState<number | null>(null)
  const gradientId = useId().replace(/:/g, '')

  const values = points
    .map((point) => point.value)
    .filter((value): value is number => value !== null)

  if (values.length === 0) {
    return (
      <div className="index-trend index-trend--empty" role="img" aria-label={emptyText}>
        <span>{emptyText}</span>
      </div>
    )
  }

  const rawMin = Math.min(0, ...values)
  const rawMax = Math.max(0, ...values)
  const span = rawMax - rawMin || 1
  const domainMin = allowNegative ? rawMin - span * 0.08 : 0
  const domainMax = rawMax + span * 0.12
  const domainSpan = domainMax - domainMin || 1

  const plotWidth = Math.max(width - MARGIN.left - MARGIN.right, 30)
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const baseline = MARGIN.top + plotHeight
  const band = plotWidth / Math.max(points.length, 1)
  const step =
    points.length > 1 ? plotWidth / (points.length - 1) : 0

  const xFor = (index: number) =>
    points.length > 1
      ? MARGIN.left + step * index
      : MARGIN.left + plotWidth / 2
  const yFor = (value: number) =>
    MARGIN.top +
    ((domainMax - value) / domainSpan) * plotHeight
  const zeroY = yFor(0)

  const ticks = [domainMax, (domainMax + domainMin) / 2, domainMin]

  const plotted: Array<PlotPoint | null> = points.map((point, index) =>
    point.value === null
      ? null
      : {
          x: xFor(index),
          y: yFor(point.value),
          value: point.value,
          index,
        },
  )

  const segments: PlotPoint[][] = []
  let current: PlotPoint[] = []
  for (const point of plotted) {
    if (point) {
      current.push(point)
    } else if (current.length > 0) {
      segments.push(current)
      current = []
    }
  }
  if (current.length > 0) segments.push(current)

  const linePaths = segments.map((segment) =>
    segment
      .map(
        (point, index) =>
          `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`,
      )
      .join(' '),
  )
  const areaPaths = segments
    .filter((segment) => segment.length > 1)
    .map((segment) => {
      const first = segment[0]
      const last = segment[segment.length - 1]
      return [
        `M ${first.x} ${zeroY}`,
        ...segment.map((point) => `L ${point.x} ${point.y}`),
        `L ${last.x} ${zeroY}`,
        'Z',
      ].join(' ')
    })

  const hoveredPoint =
    hovered === null ? null : plotted[hovered]
  const hoveredDatum = hovered === null ? null : points[hovered]
  const tooltipX =
    hovered === null
      ? 0
      : clamp(xFor(hovered), 58, Math.max(width - 58, 58))

  return (
    <div className="index-trend" ref={ref}>
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`${label}历史变化曲线，${points
          .filter((point) => point.value !== null)
          .map(
            (point) =>
              `${point.fullLabel}${formatValue(point.value as number)}`,
          )
          .join('，')}`}
      >
        <defs>
          <linearGradient
            id={`trend-fill-${gradientId}`}
            x1="0"
            y1="0"
            x2="0"
            y2="1"
          >
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {ticks.map((tick, index) => {
          const y = yFor(tick)
          return (
            <g key={`${tick}-${index}`}>
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={y}
                y2={y}
                className={index === ticks.length - 1 ? 'index-trend-base' : 'index-trend-grid'}
              />
              <text
                x={MARGIN.left - 7}
                y={y + 3}
                textAnchor="end"
                className="index-trend-axis"
              >
                {formatTick(tick)}
              </text>
            </g>
          )
        })}

        {areaPaths.map((path, index) => (
          <path
            key={`area-${index}`}
            d={path}
            fill={`url(#trend-fill-${gradientId})`}
          />
        ))}
        {linePaths.map((path, index) => (
          <path
            key={`line-${index}`}
            d={path}
            className="index-trend-line"
            style={{ stroke: color }}
          />
        ))}

        {hoveredPoint ? (
          <line
            x1={hoveredPoint.x}
            x2={hoveredPoint.x}
            y1={MARGIN.top}
            y2={baseline}
            className="index-trend-cursor"
          />
        ) : null}

        {plotted.map((point, index) =>
          point ? (
            <circle
              key={points[index].key}
              cx={point.x}
              cy={point.y}
              r={hovered === index ? 4.2 : 2.4}
              className="index-trend-dot"
              style={{ fill: color }}
            />
          ) : null,
        )}

        {points.map((point, index) =>
          index === points.length - 1 ||
          points.length <= 8 ||
          index % 2 === 0 ? (
            <text
              key={`label-${point.key}`}
              x={xFor(index)}
              y={HEIGHT - 5}
              textAnchor="middle"
              className="index-trend-x"
            >
              {point.label}
            </text>
          ) : null,
        )}

        {points.map((point, index) => {
          const hitWidth = Math.max(step, band) + 2
          return (
            <rect
              key={`hit-${point.key}`}
              x={xFor(index) - hitWidth / 2}
              y={0}
              width={hitWidth}
              height={HEIGHT}
              fill="transparent"
              onPointerEnter={() => setHovered(index)}
              onPointerLeave={() => setHovered(null)}
            />
          )
        })}
      </svg>

      {hoveredDatum && hoveredPoint ? (
        <div
          className="chart-tooltip index-trend-tooltip"
          style={{ left: `${tooltipX}px`, top: '0px' }}
          role="status"
        >
          <strong>
            {hoveredDatum.value === null
              ? '—'
              : formatValue(hoveredDatum.value)}
          </strong>
          <span className="chart-tooltip-label">
            {hoveredDatum.fullLabel}
          </span>
        </div>
      ) : null}

      <ChartTable
        label={label}
        columns={['周期', '数值']}
        rows={points.map((point) => [
          point.fullLabel,
          point.value === null ? '—' : formatValue(point.value),
        ])}
      />
    </div>
  )
}
