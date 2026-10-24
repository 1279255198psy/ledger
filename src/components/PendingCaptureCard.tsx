import { BellRing, PencilLine, X } from 'lucide-react'
import { formatMoney } from '../lib/utils'
import type {
  CaptureDirection,
  PendingCapture,
} from '../lib/capture/types'

interface PendingCaptureCardProps {
  items: PendingCapture[]
  onAnnotate: (item: PendingCapture) => void
  onIgnore: (id: string) => void
}

const DIRECTION_LABELS: Record<CaptureDirection, string> = {
  expense: '支出',
  income: '收入',
  refund: '退款',
  transfer: '转账',
  unknown: '待确认',
}

function formatWhen(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function canAnnotate(item: PendingCapture): boolean {
  // A refund is annotated too — the user picks the category it should offset.
  return item.direction !== 'transfer'
}

function sourceLabels(item: PendingCapture): string {
  return [...new Set(item.sources.map((source) => source.appLabel))]
    .filter(Boolean)
    .join(' · ')
}

/**
 * The queue between notifications and the ledger. Amount, date and account are
 * filled in; category and spending nature deliberately stay for the user.
 */
export function PendingCaptureCard({
  items,
  onAnnotate,
  onIgnore,
}: PendingCaptureCardProps) {
  if (items.length === 0) return null

  const expenseCents = items.reduce(
    (sum, item) =>
      item.direction === 'expense' ? sum + (item.amountCents ?? 0) : sum,
    0,
  )
  // A queue of refunds and transfers is not waiting for a category; it is
  // waiting for the user to confirm it should stay out of the ledger.
  const annotatableCount = items.filter(canAnnotate).length

  return (
    <section className="card pending-card" aria-label="待标注的自动记账">
      <header className="pending-head">
        <div className="pending-head-copy">
          <p className="eyebrow">
            <BellRing size={12} aria-hidden /> 自动记账
          </p>
          <h2>
            {annotatableCount > 0 ? '待标注' : '待处理'} · {items.length} 笔
          </h2>
          <p>
            {annotatableCount > 0
              ? '从付款通知里识别，金额、日期和账户已填好，补上分类与支出性质就能记进账本。'
              : '这些通知不会自动入账，确认后忽略即可。'}
          </p>
        </div>
        {expenseCents > 0 ? (
          <span className="pending-total">
            约 {formatMoney(expenseCents / 100)}
          </span>
        ) : null}
      </header>

      <div className="pending-list">
        {items.map((item) => {
          const accountText = [item.accountLabel, item.cardTail]
            .filter(Boolean)
            .join(' ')
          const annotate = canAnnotate(item)
          return (
            <article className="pending-item" key={item.id}>
              <span
                className={`pending-badge is-${item.direction}`}
                aria-label={DIRECTION_LABELS[item.direction]}
              >
                {DIRECTION_LABELS[item.direction]}
              </span>

              <div className="pending-item-copy">
                <div className="pending-item-top">
                  <strong className="pending-amount">
                    {item.amountCents === null
                      ? '金额待补'
                      : formatMoney(item.amountCents / 100)}
                  </strong>
                  <span className="pending-merchant">
                    {item.merchant || '未识别商户'}
                  </span>
                </div>
                <span className="pending-meta">
                  {sourceLabels(item)} · {formatWhen(item.occurredAt)}
                  {accountText ? ` · ${accountText}` : ''}
                </span>
                {item.issues.length > 0 ? (
                  <span className="pending-issue">
                    {[...new Set(item.issues)].join('、')}
                  </span>
                ) : null}
                {item.direction === 'refund' ? (
                  <span className="pending-issue">
                    标注后从原分类的支出里扣回，不计入收入。
                  </span>
                ) : null}
                {item.direction === 'transfer' ? (
                  <span className="pending-issue">
                    转账默认不入账；确认是消费时可手动记一笔。
                  </span>
                ) : null}
              </div>

              <div className="pending-actions">
                {annotate ? (
                  <button
                    type="button"
                    className="button primary pending-annotate"
                    onClick={() => onAnnotate(item)}
                  >
                    <PencilLine size={13} />
                    标注
                  </button>
                ) : null}
                <button
                  type="button"
                  className="button ghost pending-ignore"
                  onClick={() => onIgnore(item.id)}
                  aria-label="忽略这笔待标注"
                >
                  <X size={13} />
                  忽略
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
