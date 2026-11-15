import { formatSignedMoney } from '../lib/utils'
import type { ProjectTimingTotals } from '../lib/projectTiming'

interface ProjectTimingSummaryProps {
  totals: ProjectTimingTotals
}

/**
 * Compact report line for entries dated outside a project's own period.
 * Renders nothing when everything sits inside the project period.
 */
export function ProjectTimingSummary({ totals }: ProjectTimingSummaryProps) {
  const chips = [
    totals.preExpenseCents !== 0
      ? {
          tone: 'pre',
          text: `前置支出 ${formatSignedMoney(totals.preExpenseCents / 100)} · ${totals.preExpenseCount} 笔`,
        }
      : null,
    totals.postExpenseCents !== 0
      ? {
          tone: 'post',
          text: `后置支出 ${formatSignedMoney(totals.postExpenseCents / 100)} · ${totals.postExpenseCount} 笔`,
        }
      : null,
    totals.preIncomeCents !== 0
      ? {
          tone: 'pre',
          text: `前置收入 ${formatSignedMoney(totals.preIncomeCents / 100)} · ${totals.preIncomeCount} 笔`,
        }
      : null,
    totals.postIncomeCents !== 0
      ? {
          tone: 'post',
          text: `后置收入 ${formatSignedMoney(totals.postIncomeCents / 100)} · ${totals.postIncomeCount} 笔`,
        }
      : null,
  ].filter((chip): chip is { tone: string; text: string } => Boolean(chip))

  if (chips.length === 0) return null

  return (
    <div className="project-timing-summary" aria-label="项目周期外的流水">
      {chips.map((chip) => (
        <span key={chip.text} className={`timing-pill is-${chip.tone}`}>
          {chip.text}
        </span>
      ))}
    </div>
  )
}
