import { useEffect, useState } from 'react'
import { RotateCcw, X } from 'lucide-react'
import { useSync } from '../hooks/useSync'
import { dismissSyncUndo, undoSyncDeletion } from '../lib/sync/engine'

/** How long the undo stays reachable before it is silently accepted. */
const NOTICE_MS = 20000

/**
 * The only interactive sync message: it appears solely when a merge removed
 * records that existed on this device. Ordinary syncs stay silent.
 */
export function SyncUndoNotice() {
  const { syncUndo } = useSync()
  const [busy, setBusy] = useState(false)
  const noticeAt = syncUndo?.at ?? null

  useEffect(() => {
    if (!noticeAt) return
    const timer = window.setTimeout(() => dismissSyncUndo(), NOTICE_MS)
    return () => window.clearTimeout(timer)
  }, [noticeAt])

  if (!syncUndo) return null

  return (
    <div className="sync-undo" role="status" aria-live="polite">
      <span className="sync-undo-text">
        同步时删除了 {syncUndo.removed} 条记录
      </span>
      <button
        type="button"
        className="sync-undo-action"
        onClick={() => {
          setBusy(true)
          void undoSyncDeletion().finally(() => setBusy(false))
        }}
        disabled={busy}
      >
        <RotateCcw size={14} />
        {busy ? '正在恢复…' : '撤销'}
      </button>
      <button
        type="button"
        className="sync-undo-close"
        onClick={() => dismissSyncUndo()}
        aria-label="关闭提示"
      >
        <X size={14} />
      </button>
    </div>
  )
}
