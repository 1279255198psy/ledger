import { Plus, Sparkles } from 'lucide-react'

interface EmptyLedgerProps {
  onAdd: () => void
  onLoadSample: () => void
}

export function EmptyLedger({ onAdd, onLoadSample }: EmptyLedgerProps) {
  return (
    <section
      className="card empty-ledger"
      aria-labelledby="empty-ledger-title"
    >
      <div className="empty-ledger-art" aria-hidden="true">
        <span className="empty-ledger-sheet empty-ledger-sheet--back" />
        <span className="empty-ledger-sheet empty-ledger-sheet--middle" />
        <span className="empty-ledger-sheet empty-ledger-sheet--front">账</span>
      </div>

      <p className="eyebrow">A FRESH PAGE</p>
      <h2 id="empty-ledger-title">从第一笔，写下你的账页</h2>
      <p className="empty-ledger-copy">
        不用先整理好一切。记下一顿早餐、一趟地铁，这个月的收支和趋势就会慢慢长出来。
      </p>

      <div className="empty-ledger-actions">
        <button type="button" className="button primary" onClick={onAdd}>
          <Plus size={16} />
          记下第一笔
        </button>
        <button type="button" className="button secondary" onClick={onLoadSample}>
          <Sparkles size={15} />
          先看看示例账本
        </button>
      </div>

      <p className="empty-ledger-hint">
        账目只保存在本机 · 无需登录 · 随时导出备份
      </p>
    </section>
  )
}
