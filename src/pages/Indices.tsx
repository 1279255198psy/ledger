import { useEffect, useMemo, useState } from 'react'
import {
  Activity,
  Anchor,
  ChevronDown,
  CreditCard,
  Feather,
  Hourglass,
  Info,
  PiggyBank,
  Scale,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingUp,
  UtensilsCrossed,
  Waves,
} from 'lucide-react'
import { MetricTrendChart } from '../components/charts/MetricTrendChart'
import { EmptyLedger } from '../components/EmptyLedger'
import { buildHealthDashboard } from '../lib/health'
import type { HealthDetail } from '../lib/health'
import {
  DEFAULT_HIDDEN_INDEX_METRICS,
  loadIndexPreferences,
  saveIndexPreferences,
} from '../lib/storage'
import {
  currentMonthKey,
  formatAxisNumber,
  formatMoney,
  formatPercent,
  formatSignedMoney,
  monthLabel,
} from '../lib/utils'
import type {
  BudgetBook,
  IndexMetricKey,
  IndexPreferences,
  LedgerTransaction,
  Liability,
  View,
} from '../types'

interface IndicesProps {
  transactions: LedgerTransaction[]
  liabilities: Liability[]
  budgets: BudgetBook
  /** Projects set to「计入日常」 also spend from the daily budget. */
  countedProjectIds: ReadonlySet<string>
  openingBalance: number
  monthKey: string
  onAdd: () => void
  onLoadSample: () => void
  onChangeView: (view: View) => void
}

type StatusTone = 'good' | 'warn' | 'bad' | 'neutral'

interface MetricConfig {
  key: IndexMetricKey
  label: string
  kicker: string
  icon: typeof Anchor
  formula: string
  reference: string
  color: string
  allowNegative?: boolean
  value: (detail: HealthDetail) => number | null
  display: (value: number) => string
  formatValue: (value: number) => string
  formatTick: (value: number) => string
  detailLine: (detail: HealthDetail) => string
}

const percentDisplay = (value: number) => formatPercent(value, 1)
const percentTick = (value: number) => `${Math.round(value)}%`
const monthsDisplay = (value: number) => `${value.toFixed(1)} 个月`
const countPercentDisplay = (value: number) => `${Math.round(value)}%`
const signedPercentDisplay = (value: number) =>
  `${value > 0 ? '+' : ''}${formatPercent(value, 1)}`
const debtFreeDisplay = (value: number) =>
  value <= 0 ? '已清零' : `${value.toFixed(1)} 个月`

const METRICS: MetricConfig[] = [
  {
    key: 'engel',
    label: '恩格尔系数',
    kicker: 'ENGEL',
    icon: UtensilsCrossed,
    formula: '餐饮支出 ÷ 总消费支出',
    reference: '20%–40% 通常较宽裕；高于 50% 说明餐饮挤占了较多支出。',
    color: 'var(--tone-clay)',
    value: (detail) => detail.engel,
    display: percentDisplay,
    formatValue: percentDisplay,
    formatTick: percentTick,
    detailLine: (detail) =>
      `餐饮 ${formatMoney(detail.foodCents / 100)} · 总支出 ${formatMoney(
        detail.totalExpenseCents / 100,
      )}`,
  },
  {
    key: 'savings',
    label: '储蓄率',
    kicker: 'SAVING RATE',
    icon: PiggyBank,
    formula: '(收入 − 支出) ÷ 收入',
    reference: '参考 ≥20%；30% 以上更从容，长期为负需要警惕。',
    color: 'var(--positive)',
    allowNegative: true,
    value: (detail) => detail.savings,
    display: percentDisplay,
    formatValue: percentDisplay,
    formatTick: percentTick,
    detailLine: (detail) =>
      `收入 ${formatMoney(detail.totalIncomeCents / 100)} · 支出 ${formatMoney(
        detail.totalExpenseCents / 100,
      )}`,
  },
  {
    key: 'essential',
    label: '必要支出占比',
    kicker: 'ESSENTIAL',
    icon: ShieldCheck,
    formula: '刚需支出 ÷ 总消费支出',
    reference: '参考 50%–70%；占比越低，可调整的弹性空间越大。',
    color: 'var(--tone-olive)',
    value: (detail) => detail.essentialRatio,
    display: percentDisplay,
    formatValue: percentDisplay,
    formatTick: percentTick,
    detailLine: (detail) =>
      `刚需 ${formatMoney(detail.essentialCents / 100)}`,
  },
  {
    key: 'flexible',
    label: '弹性消费占比',
    kicker: 'FLEXIBLE',
    icon: Feather,
    formula: '弹性支出 ÷ 总消费支出',
    reference: '参考 20%–40%；保留适度弹性，也不宜长期过高。',
    color: 'var(--tone-amber)',
    value: (detail) => detail.flexibleRatio,
    display: percentDisplay,
    formatValue: percentDisplay,
    formatTick: percentTick,
    detailLine: (detail) =>
      `弹性 ${formatMoney(detail.flexibleCents / 100)}`,
  },
  {
    key: 'emergency',
    label: '应急金覆盖月数',
    kicker: 'EMERGENCY FUND',
    icon: ShieldCheck,
    formula: '可快速动用活期资产 ÷ 月均必要支出',
    reference:
      '参考 3–6 个月；活期资产 = 起始资金 + 累计收入 − 累计支出。',
    color: 'var(--tone-teal)',
    value: (detail) => detail.emergencyMonths,
    display: monthsDisplay,
    formatValue: monthsDisplay,
    formatTick: (value) => `${Math.round(value)}`,
    detailLine: (detail) =>
      `活期资产 ${formatMoney(
        detail.liquidAssetsCents / 100,
      )} · 月均刚需 ${formatMoney(detail.monthlyEssentialCents / 100)}`,
  },
  {
    key: 'debt',
    label: '负债收入比',
    kicker: 'DEBT TO INCOME',
    icon: CreditCard,
    formula: '月均固定还款 ÷ 月均收入',
    reference: '参考 <20%；超过 40% 时还款压力偏高。按近 6 个月还款记录估算。',
    color: 'var(--negative)',
    value: (detail) => detail.debtRatio,
    display: percentDisplay,
    formatValue: percentDisplay,
    formatTick: percentTick,
    detailLine: (detail) =>
      `月均还款 ${formatMoney(
        detail.monthlyDebtCents / 100,
      )} · 月均收入 ${formatMoney(detail.monthlyIncomeCents / 100)}`,
  },
  {
    key: 'netWorth',
    label: '净资产',
    kicker: 'NET WORTH',
    icon: Scale,
    formula: '总资产 − 总负债',
    reference:
      '参考为正且持续增长；资产按活期余额估算，负债取未还本金。',
    color: 'var(--tone-indigo)',
    allowNegative: true,
    value: (detail) => detail.netWorthCents / 100,
    display: (value) => formatSignedMoney(value),
    formatValue: (value) => formatSignedMoney(value),
    formatTick: (value) => formatAxisNumber(value),
    detailLine: (detail) =>
      `资产 ${formatMoney(
        detail.totalAssetsCents / 100,
      )} · 负债 ${formatMoney(detail.totalLiabilitiesCents / 100)}`,
  },
  {
    key: 'incomeStability',
    label: '收入稳定性',
    kicker: 'INCOME STABILITY',
    icon: Activity,
    formula: '月收入标准差 ÷ 月均收入',
    reference:
      '参考 <20%；按近 6 个完整月份计算，至少需要 3 个月收入记录。',
    color: 'var(--tone-sky)',
    value: (detail) => detail.incomeStability,
    display: percentDisplay,
    formatValue: percentDisplay,
    formatTick: percentTick,
    detailLine: (detail) =>
      detail.incomeStability === null
        ? '收入记录还不足 3 个月'
        : `月均收入 ${formatMoney(
            detail.monthlyIncomeAverageCents / 100,
          )} · 标准差 ${formatMoney(
            detail.monthlyIncomeDeviationCents / 100,
          )}`,
  },
  {
    key: 'spendingVolatility',
    label: '支出波动率',
    kicker: 'SPENDING VOLATILITY',
    icon: Waves,
    formula: '月支出标准差 ÷ 月均支出',
    reference:
      '参考 <30%；按近 6 个完整月份计算，一次性大额支出会拉高数值。',
    color: 'var(--tone-plum)',
    value: (detail) => detail.spendingVolatility,
    display: percentDisplay,
    formatValue: percentDisplay,
    formatTick: percentTick,
    detailLine: (detail) =>
      detail.spendingVolatility === null
        ? '支出记录还不足 3 个月'
        : `月均支出 ${formatMoney(
            detail.monthlyExpenseAverageCents / 100,
          )} · 标准差 ${formatMoney(
            detail.monthlyExpenseDeviationCents / 100,
          )}`,
  },
  {
    key: 'budgetAdherence',
    label: '预算执行率',
    kicker: 'BUDGET ADHERENCE',
    icon: Target,
    formula: '未超原定预算的月份 ÷ 已设预算的月份',
    reference:
      '参考 ≥80%；只统计近 6 个完整月份中确实设过预算的月份，按原定月预算比较，不含上下调。',
    color: 'var(--tone-gold)',
    value: (detail) => detail.budgetAdherence,
    display: countPercentDisplay,
    formatValue: countPercentDisplay,
    formatTick: percentTick,
    detailLine: (detail) =>
      detail.budgetTotalMonths === 0
        ? '还没有设置过预算'
        : `近 ${detail.budgetTotalMonths} 个设预算的月份 · ${detail.budgetWithinMonths} 个未超支`,
  },
  {
    key: 'netWorthGrowth',
    label: '净资产增长率',
    kicker: 'NET WORTH GROWTH',
    icon: TrendingUp,
    formula: '(本期净资产 − 半年前净资产) ÷ |半年前净资产|',
    reference:
      '参考为正；按月看 6 个月前，按季度看 2 个季度前。基期净资产为 0 时暂不计算。',
    color: 'var(--tone-forest)',
    allowNegative: true,
    value: (detail) => detail.netWorthGrowth,
    display: signedPercentDisplay,
    formatValue: signedPercentDisplay,
    formatTick: percentTick,
    detailLine: (detail) =>
      detail.netWorthBaseCents === null
        ? '数据还不足半年'
        : detail.netWorthBaseCents === 0
          ? '半年前净资产为 0，暂不计算增幅'
          : `当前 ${formatSignedMoney(
              detail.netWorthCents / 100,
            )} · 半年前 ${formatSignedMoney(
              detail.netWorthBaseCents / 100,
            )}`,
  },
  {
    key: 'debtFreeMonths',
    label: '负债清零月数',
    kicker: 'DEBT FREE',
    icon: Hourglass,
    formula: '剩余负债 ÷ 月均还款',
    reference:
      '参考越短越好；按近 6 个月的还款速度估算，没有还款记录时暂不计算。',
    color: 'var(--tone-rose)',
    value: (detail) => detail.debtFreeMonths,
    display: debtFreeDisplay,
    formatValue: debtFreeDisplay,
    formatTick: (value) => `${Math.round(value)}`,
    detailLine: (detail) =>
      detail.totalLiabilitiesCents <= 0
        ? '当前没有未还负债'
        : `剩余负债 ${formatMoney(
            detail.totalLiabilitiesCents / 100,
          )} · 月均还款 ${formatMoney(detail.monthlyDebtCents / 100)}`,
  },
]

function statusFor(
  key: IndexMetricKey,
  value: number | null,
): { label: string; tone: StatusTone } {
  if (value === null) return { label: '暂无', tone: 'neutral' }
  switch (key) {
    case 'engel':
      if (value <= 30) return { label: '宽裕', tone: 'good' }
      if (value <= 40) return { label: '合理', tone: 'good' }
      if (value <= 50) return { label: '略高', tone: 'warn' }
      return { label: '偏高', tone: 'bad' }
    case 'savings':
      if (value >= 30) return { label: '充足', tone: 'good' }
      if (value >= 20) return { label: '健康', tone: 'good' }
      if (value >= 10) return { label: '一般', tone: 'warn' }
      if (value >= 0) return { label: '偏低', tone: 'warn' }
      return { label: '负储蓄', tone: 'bad' }
    case 'essential':
      if (value <= 60) return { label: '稳健', tone: 'good' }
      if (value <= 75) return { label: '尚可', tone: 'warn' }
      if (value <= 90) return { label: '偏高', tone: 'warn' }
      return { label: '高刚需', tone: 'bad' }
    case 'flexible':
      if (value < 15) return { label: '偏紧', tone: 'warn' }
      if (value <= 45) return { label: '合理', tone: 'good' }
      if (value <= 60) return { label: '偏高', tone: 'warn' }
      return { label: '过高', tone: 'bad' }
    case 'emergency':
      if (value >= 6) return { label: '充足', tone: 'good' }
      if (value >= 3) return { label: '达标', tone: 'good' }
      if (value >= 1) return { label: '偏薄', tone: 'warn' }
      return { label: '不足', tone: 'bad' }
    case 'debt':
      if (value <= 20) return { label: '健康', tone: 'good' }
      if (value <= 40) return { label: '尚可', tone: 'warn' }
      if (value <= 60) return { label: '偏高', tone: 'warn' }
      return { label: '高压', tone: 'bad' }
    case 'netWorth':
      if (value > 0) return { label: '为正', tone: 'good' }
      if (value < 0) return { label: '为负', tone: 'bad' }
      return { label: '持平', tone: 'neutral' }
    case 'incomeStability':
      if (value <= 15) return { label: '稳定', tone: 'good' }
      if (value <= 25) return { label: '较稳', tone: 'good' }
      if (value <= 40) return { label: '起伏', tone: 'warn' }
      return { label: '波动大', tone: 'bad' }
    case 'spendingVolatility':
      if (value <= 15) return { label: '平稳', tone: 'good' }
      if (value <= 30) return { label: '正常', tone: 'good' }
      if (value <= 50) return { label: '起伏', tone: 'warn' }
      return { label: '波动大', tone: 'bad' }
    case 'budgetAdherence':
      if (value >= 80) return { label: '良好', tone: 'good' }
      if (value >= 60) return { label: '一般', tone: 'warn' }
      return { label: '常超支', tone: 'bad' }
    case 'netWorthGrowth':
      if (value > 0) return { label: '增长', tone: 'good' }
      if (value === 0) return { label: '持平', tone: 'neutral' }
      if (value >= -10) return { label: '回落', tone: 'warn' }
      return { label: '缩水', tone: 'bad' }
    case 'debtFreeMonths':
      if (value <= 0) return { label: '已清', tone: 'good' }
      if (value <= 12) return { label: '一年内', tone: 'good' }
      if (value <= 36) return { label: '可期', tone: 'warn' }
      if (value <= 60) return { label: '较长', tone: 'warn' }
      return { label: '遥远', tone: 'bad' }
    default:
      return { label: '暂无', tone: 'neutral' }
  }
}

export function Indices({
  transactions,
  liabilities,
  budgets,
  countedProjectIds,
  openingBalance,
  monthKey,
  onAdd,
  onLoadSample,
  onChangeView,
}: IndicesProps) {
  const [preferences, setPreferences] =
    useState<IndexPreferences>(loadIndexPreferences)
  const [displayOpen, setDisplayOpen] = useState(false)

  const hidden = useMemo(
    () => new Set(preferences.hidden),
    [preferences.hidden],
  )

  const dashboard = useMemo(
    () =>
      buildHealthDashboard(
        transactions,
        liabilities,
        Math.round(openingBalance * 100),
        monthKey,
        preferences.granularity,
        {
          hidden,
          budgets,
          countedProjectIds,
        },
      ),
    [
      transactions,
      liabilities,
      openingBalance,
      monthKey,
      preferences.granularity,
      hidden,
      budgets,
      countedProjectIds,
    ],
  )

  useEffect(() => {
    if (!displayOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Element | null
      if (!target?.closest('.index-display')) setDisplayOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () =>
      document.removeEventListener('pointerdown', handlePointerDown)
  }, [displayOpen])

  const updatePreferences = (next: IndexPreferences) => {
    setPreferences(next)
    saveIndexPreferences(next)
  }

  const handleGranularity = (granularity: IndexPreferences['granularity']) => {
    if (granularity === preferences.granularity) return
    updatePreferences({ ...preferences, granularity })
  }

  const toggleMetric = (key: IndexMetricKey) => {
    const nextHidden = hidden.has(key)
      ? preferences.hidden.filter((item) => item !== key)
      : [...preferences.hidden, key]
    updatePreferences({ ...preferences, hidden: nextHidden })
  }

  if (transactions.length === 0 && liabilities.length === 0) {
    return (
      <div className="page-stack indices-page">
        <EmptyLedger onAdd={onAdd} onLoadSample={onLoadSample} />
      </div>
    )
  }

  const detail = dashboard.detail
  const score = detail.score
  const visibleMetrics = METRICS.filter((metric) => !hidden.has(metric.key))
  const currentMonth = currentMonthKey()
  const quarterOf = (key: string) =>
    `${key.slice(0, 4)}-Q${Math.floor(
      (Number(key.slice(5, 7)) - 1) / 3,
    ) + 1}`
  const isCurrentQuarter =
    preferences.granularity === 'quarter' &&
    quarterOf(monthKey) === quarterOf(currentMonth)
  const periodCaption =
    preferences.granularity === 'month'
      ? monthLabel(monthKey)
      : `${detail.periodFullLabel}${isCurrentQuarter ? ' · 至今' : ''}`

  const ringRadius = 52
  const ringCircumference = 2 * Math.PI * ringRadius
  const ringValue = score?.score ?? 0
  const scoreTone = score?.tone ?? 'pending'

  return (
    <div className="page-stack indices-page">
      <div className="index-toolbar">
        <div>
          <p className="card-kicker">FINANCIAL VITALS</p>
          <h2>财务体检卡</h2>
          <p className="index-toolbar-sub">
            截至 {periodCaption}，全部由本机流水与资产负债自动计算。
          </p>
        </div>
        <div className="index-toolbar-actions">
          <div
            className="index-segment"
            role="group"
            aria-label="统计周期"
          >
            <button
              type="button"
              className={
                preferences.granularity === 'month' ? 'is-active' : ''
              }
              onClick={() => handleGranularity('month')}
              aria-pressed={preferences.granularity === 'month'}
            >
              按月
            </button>
            <button
              type="button"
              className={
                preferences.granularity === 'quarter' ? 'is-active' : ''
              }
              onClick={() => handleGranularity('quarter')}
              aria-pressed={preferences.granularity === 'quarter'}
            >
              按季度
            </button>
          </div>

          <div className="index-display">
            <button
              type="button"
              className="index-display-trigger"
              onClick={() => setDisplayOpen((open) => !open)}
              aria-expanded={displayOpen}
              aria-haspopup="dialog"
            >
              <SlidersHorizontal size={15} />
              显示指标
              <ChevronDown
                size={13}
                className={displayOpen ? 'is-open' : ''}
              />
            </button>

            {displayOpen ? (
              <div
                className="index-display-popover"
                role="dialog"
                aria-label="选择显示的指标"
              >
                <p className="index-display-title">卡片显示</p>
                <label className="index-display-row is-locked">
                  <input type="checkbox" checked disabled />
                  <span>综合财务得分</span>
                  <small>固定</small>
                </label>
                {METRICS.map((metric) => (
                  <label
                    className="index-display-row"
                    key={metric.key}
                  >
                    <input
                      type="checkbox"
                      checked={!hidden.has(metric.key)}
                      onChange={() => toggleMetric(metric.key)}
                    />
                    <span>{metric.label}</span>
                  </label>
                ))}
                <p className="index-display-hint">
                  综合得分固定展示，但只计入可计分且已勾选的指标；取消勾选会同步改变得分，选择保存在本机。
                </p>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {dashboard.unmarkedTotalCount > 0 ? (
        <div className="index-note">
          <Info size={15} />
          <span>
            有 {dashboard.unmarkedTotalCount} 笔历史支出（
            {formatMoney(dashboard.unmarkedTotalCents / 100)}）还没标记刚需 /
            弹性，当前按分类推断。新记支出时会要求选择。
          </span>
          <button
            type="button"
            className="text-link"
            onClick={() => onChangeView('transactions')}
          >
            去流水查看
          </button>
        </div>
      ) : null}

      <article
        className={`card index-score-card is-${scoreTone}`}
        aria-labelledby="index-score-title"
      >
        <div className="index-score-main">
          <div className="score-ring" aria-hidden="true">
            <svg viewBox="0 0 120 120">
              <circle
                cx="60"
                cy="60"
                r={ringRadius}
                className="score-ring-track"
              />
              <circle
                cx="60"
                cy="60"
                r={ringRadius}
                className="score-ring-progress"
                strokeDasharray={`${
                  (ringCircumference * ringValue) / 100
                } ${ringCircumference}`}
                transform="rotate(-90 60 60)"
              />
            </svg>
            <div className="score-ring-label">
              <strong>{score ? score.score : '—'}</strong>
              <span>/ 100</span>
            </div>
          </div>

          <div className="index-score-copy">
            <div className="index-score-title-row">
              <h2 id="index-score-title">综合财务健康度</h2>
              <span className={`score-grade is-${scoreTone}`}>
                {score ? score.grade : '待生成'}
              </span>
            </div>
            <p className="index-score-comment">
              {score
                ? score.comment
                : detail.totalIncomeCents + detail.totalExpenseCents > 0
                  ? '在「显示指标」里至少保留一个可计分的指标，综合得分才会生成。'
                  : '记录一些收支后，综合得分会随着你的账本一起长出来。'}
            </p>
            {score?.focus ? (
              <p className="index-score-focus">
                最需关注 · {score.focus}
              </p>
            ) : null}
            <p className="index-score-meta">
              按当前显示的可计分指标加权得出；隐藏或暂无数据的指标不计入，权重在其余指标间重新分配。
            </p>
          </div>
        </div>

        <div className="index-score-side">
          <div className="score-scale" aria-hidden="true">
            <div className="score-scale-track">
              <span
                className="score-scale-fill"
                style={{ width: `${score?.score ?? 0}%` }}
              />
              {[40, 55, 70, 85].map((mark) => (
                <i
                  key={mark}
                  className="score-scale-mark"
                  style={{ left: `${mark}%` }}
                />
              ))}
            </div>
            <div className="score-scale-labels">
              <span>风险</span>
              <span>需留意</span>
              <span>稳健</span>
              <span>健康</span>
              <span>优秀</span>
            </div>
          </div>

          {score ? (
            <div className="score-parts">
              {score.parts.map((part) => (
                <div className="score-part" key={part.key}>
                  <span className="score-part-label">{part.label}</span>
                  <span
                    className="score-part-meter"
                    aria-hidden="true"
                  >
                    <i
                      style={{
                        width: `${part.score ?? 0}%`,
                      }}
                    />
                  </span>
                  <strong>
                    {part.score === null ? '—' : Math.round(part.score)}
                  </strong>
                  <small>{part.weight}%</small>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </article>

      {visibleMetrics.length > 0 ? (
        <div className="index-grid">
          {visibleMetrics.map((metric) => {
            const value = metric.value(detail)
            const status = statusFor(metric.key, value)
            return (
              <article
                className="card index-card"
                key={metric.key}
                aria-labelledby={`index-card-${metric.key}`}
              >
                <div className="index-card-head">
                  <span
                    className="index-card-icon"
                    style={{ color: metric.color }}
                  >
                    <metric.icon size={17} />
                  </span>
                  <div className="index-card-titles">
                    <p className="index-card-kicker">
                      {metric.kicker}
                    </p>
                    <h3 id={`index-card-${metric.key}`}>
                      {metric.label}
                    </h3>
                  </div>
                  <span
                    className={`index-status is-${status.tone}`}
                  >
                    {status.label}
                  </span>
                </div>

                <p className="index-card-value">
                  {value === null ? '—' : metric.display(value)}
                </p>
                <p className="index-card-formula">{metric.formula}</p>

                <MetricTrendChart
                  points={dashboard.series[metric.key]}
                  formatValue={metric.formatValue}
                  formatTick={metric.formatTick}
                  allowNegative={metric.allowNegative}
                  color={metric.color}
                  emptyText="这个周期还没有足够的数据"
                  label={`${metric.label}历史趋势`}
                />

                <div className="index-card-foot">
                  <p className="index-card-detail">
                    {metric.detailLine(detail)}
                  </p>
                  <p className="index-card-reference">
                    <span>参考区间</span>
                    {metric.reference}
                  </p>
                </div>
              </article>
            )
          })}
        </div>
      ) : (
        <div className="card index-hidden-callout">
          <p>
            所有指标都已隐藏。综合得分需要至少一个显示的指标，勾选上方指标即可恢复。
          </p>
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              updatePreferences({
                ...preferences,
                hidden: [...DEFAULT_HIDDEN_INDEX_METRICS],
              })
            }
          >
            恢复默认显示
          </button>
        </div>
      )}

      <p className="index-disclaimer">
        指数只做参考，不构成投资或借贷建议。旧数据未标记时按分类推断；
        可随时在流水中修改。
      </p>
    </div>
  )
}
