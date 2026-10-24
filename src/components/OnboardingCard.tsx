import { ArrowRight, Check } from 'lucide-react'

interface OnboardingCardProps {
  hasMonthBudget: boolean
  hasCategoryBudget: boolean
  onOpenBudget: () => void
  onOpenGuide: () => void
  onDismiss: () => void
}

/**
 * Shown on the overview until the everyday setup is done. Progress is derived
 * from the ledger itself, so importing a backup or syncing another device
 * resolves the right steps without any extra bookkeeping.
 */
export function OnboardingCard({
  hasMonthBudget,
  hasCategoryBudget,
  onOpenBudget,
  onOpenGuide,
  onDismiss,
}: OnboardingCardProps) {
  const steps = [
    {
      id: 'budget',
      title: '设置本月预算',
      hint: '定一个数，首页才知道这个月还剩多少',
      done: hasMonthBudget,
      onOpen: onOpenBudget,
    },
    {
      id: 'category-budget',
      title: '给常花的分类设上限',
      hint: '餐饮、购物各留多少，快超时会提醒',
      done: hasCategoryBudget,
      onOpen: onOpenBudget,
    },
  ]
  const doneCount = steps.filter((step) => step.done).length
  if (doneCount === steps.length) return null

  return (
    <section className="card onboarding-card" aria-labelledby="onboarding-title">
      <div className="onboarding-head">
        <div>
          <p className="card-kicker">GETTING STARTED</p>
          <h2 id="onboarding-title">上手清单</h2>
          <p className="card-sub">
            账页功能不少，日常先把预算设好就够了；其余用到时再看。
          </p>
        </div>
        <span className="onboarding-count">
          {doneCount} / {steps.length}
        </span>
      </div>

      <ol className="onboarding-list">
        {steps.map((step) => (
          <li key={step.id}>
            <button
              type="button"
              className={`onboarding-step${step.done ? ' is-done' : ''}`}
              onClick={step.onOpen}
              disabled={step.done}
            >
              <span className="onboarding-mark" aria-hidden="true">
                {step.done ? <Check size={13} strokeWidth={2.4} /> : null}
              </span>
              <span className="onboarding-copy">
                <strong>{step.title}</strong>
                <small>{step.hint}</small>
              </span>
              {step.done ? null : <ArrowRight size={15} aria-hidden="true" />}
            </button>
          </li>
        ))}
      </ol>

      <div className="onboarding-foot">
        <button type="button" className="text-link" onClick={onOpenGuide}>
          更多用法
          <ArrowRight size={13} />
        </button>
        <button type="button" className="onboarding-dismiss" onClick={onDismiss}>
          不再提示
        </button>
      </div>
    </section>
  )
}
