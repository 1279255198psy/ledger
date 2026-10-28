import {
  CalendarClock,
  Pause,
  PencilLine,
  Play,
  Plus,
  Repeat2,
  Trash2,
  X,
} from 'lucide-react'
import { Modal } from './Modal'
import { CategoryIcon } from './CategoryIcon'
import { getCategoryPathName } from '../lib/categories'
import {
  describeFrequency,
  formatRecurringDate,
  nextDueDate,
} from '../lib/recurring'
import { formatMoney } from '../lib/utils'
import type { Category, RecurringRule } from '../types'

interface RecurringRulesModalProps {
  open: boolean
  rules: RecurringRule[]
  categories: Category[]
  pendingCount: number
  onClose: () => void
  onNew: () => void
  onEdit: (rule: RecurringRule) => void
  onToggle: (rule: RecurringRule) => void
  onDelete: (id: string) => void
}

/**
 * Rule management lives on the transactions page, not in settings: a rule is
 * part of the books, not an app preference.
 */
export function RecurringRulesModal({
  open,
  rules,
  categories,
  pendingCount,
  onClose,
  onNew,
  onEdit,
  onToggle,
  onDelete,
}: RecurringRulesModalProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="recurring-rules-title"
      className="recurring-rules-modal"
    >
      <header className="modal-header">
        <div>
          <p className="eyebrow">
            <Repeat2 size={12} aria-hidden /> 周期记账
          </p>
          <h2 id="recurring-rules-title">周期规则</h2>
        </div>
        <button
          type="button"
          className="icon-button"
          onClick={onClose}
          aria-label="关闭"
        >
          <X size={19} />
        </button>
      </header>

      <div className="modal-body recurring-rules-body">
        <p className="recurring-rules-intro">
          房租、工资、会员费这类固定账，到期会自动记上；水电这种金额会变的账，可以设成到期后等你确认。
          {pendingCount > 0
            ? ` 现在有 ${pendingCount} 期待确认。`
            : ''}
        </p>

        {rules.length === 0 ? (
          <div className="recurring-rules-empty">
            <span className="recurring-rules-empty-icon" aria-hidden>
              <CalendarClock size={22} />
            </span>
            <h3>还没有周期规则</h3>
            <p>
              也可以在记一笔时打开「设为周期记账」，这一笔会作为规则的第一期。
            </p>
            <button type="button" className="button primary" onClick={onNew}>
              <Plus size={15} />
              新建周期规则
            </button>
          </div>
        ) : (
          <ul className="recurring-rules-list">
            {rules.map((rule) => {
              const category = categories.find(
                (item) =>
                  item.id === rule.template.categoryId &&
                  item.type === rule.template.type,
              )
              const next = nextDueDate(rule)
              const title =
                rule.template.note ||
                (category ? getCategoryPathName(category) : '未命名周期账')
              return (
                <li
                  className={`recurring-rule-item${
                    rule.enabled ? '' : ' is-paused'
                  }`}
                  key={rule.id}
                >
                  <span
                    className={`recurring-rule-icon is-${rule.template.type}`}
                    aria-hidden
                  >
                    {category ? (
                      <CategoryIcon category={category} size={18} />
                    ) : (
                      <Repeat2 size={18} />
                    )}
                  </span>

                  <div className="recurring-rule-copy">
                    <div className="recurring-rule-top">
                      <strong>{title}</strong>
                      <span
                        className={`recurring-rule-amount is-${rule.template.type}`}
                      >
                        {rule.template.type === 'income' ? '+' : '−'}
                        {formatMoney(rule.template.amountCents / 100)}
                      </span>
                    </div>
                    <span className="recurring-rule-meta">
                      {category ? `${getCategoryPathName(category)} · ` : ''}
                      {describeFrequency(rule.frequency)} ·{' '}
                      {rule.mode === 'auto' ? '自动入账' : '等我确认'}
                    </span>
                    <span className="recurring-rule-next">
                      {rule.enabled
                        ? next
                          ? `下次 ${formatRecurringDate(next)}${
                              rule.endDate
                                ? ` · 到 ${formatRecurringDate(rule.endDate)} 结束`
                                : ''
                            }`
                          : '没有下一期了'
                        : `已暂停${
                            rule.stoppedAt
                              ? ` · ${formatRecurringDate(
                                  rule.stoppedAt.slice(0, 10),
                                )}`
                              : ''
                          }`}
                    </span>
                  </div>

                  <div className="recurring-rule-actions">
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => onEdit(rule)}
                      aria-label={`编辑周期规则 ${title}`}
                      title="编辑"
                    >
                      <PencilLine size={15} />
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      onClick={() => onToggle(rule)}
                      aria-label={
                        rule.enabled
                          ? `暂停周期规则 ${title}`
                          : `启用周期规则 ${title}`
                      }
                      title={rule.enabled ? '暂停' : '启用'}
                    >
                      {rule.enabled ? (
                        <Pause size={15} />
                      ) : (
                        <Play size={15} />
                      )}
                    </button>
                    <button
                      type="button"
                      className="icon-button is-danger"
                      onClick={() => onDelete(rule.id)}
                      aria-label={`删除周期规则 ${title}`}
                      title="删除"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <footer className="modal-footer">
        <span className="modal-footnote">
          规则会随账本同步，已生成的流水不受影响
        </span>
        <div className="modal-actions">
          <button type="button" className="button ghost" onClick={onClose}>
            关闭
          </button>
          <button type="button" className="button primary" onClick={onNew}>
            <Plus size={15} />
            新建规则
          </button>
        </div>
      </footer>
    </Modal>
  )
}
