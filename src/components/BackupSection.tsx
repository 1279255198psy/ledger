import { useCallback, useEffect, useState } from 'react'
import {
  Check,
  Clock,
  HardDrive,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import {
  BACKUP_REASON_LABELS,
  createBackup,
  deleteBackup,
  inspectBackup,
  listBackups,
  type BackupInspection,
  type BackupMeta,
  type BackupReason,
} from '../lib/backup'
import { confirmDesktopAction } from '../lib/desktop'
import { applyLedgerDataSnapshot } from '../lib/storage'
import { formatBytes } from '../lib/storageReport'
import { getSyncState, noteLocalRestore } from '../lib/sync/engine'

interface BackupSectionProps {
  onNotify: (message: string, kind: 'success' | 'error') => void
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '时间未知'
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function reasonLabel(reason: BackupReason): string {
  return BACKUP_REASON_LABELS[reason] ?? '备份'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '操作失败，请稍后重试'
}

function countText(counts: BackupInspection['counts']): string {
  const parts = [`${counts.transactions} 笔流水`]
  if (counts.projects > 0) parts.push(`${counts.projects} 个项目`)
  if (counts.liabilities > 0) parts.push(`${counts.liabilities} 笔负债`)
  return parts.join(' · ')
}

function rangeText(inspection: BackupInspection): string {
  if (!inspection.firstDate || !inspection.lastDate) return '没有流水记录'
  if (inspection.firstDate === inspection.lastDate) {
    return `流水日期 ${inspection.firstDate}`
  }
  return `流水日期 ${inspection.firstDate} 至 ${inspection.lastDate}`
}

/**
 * Rolling local snapshots plus a restore rehearsal. "检查" parses and
 * normalizes a backup without writing anything, so a corrupt or incompatible
 * file is discovered before it can replace the live ledger.
 */
export function BackupSection({ onNotify }: BackupSectionProps) {
  const [backups, setBackups] = useState<BackupMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [checked, setChecked] = useState<BackupInspection | null>(null)

  const refresh = useCallback(async () => {
    try {
      const next = await listBackups()
      setBackups(next)
      setFailed(false)
    } catch {
      setBackups([])
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleCreate = async () => {
    setBusy('create')
    try {
      const meta = await createBackup('manual')
      await refresh()
      onNotify(
        `已备份 ${meta.counts?.transactions ?? 0} 笔流水，保存在本机`,
        'success',
      )
    } catch (error) {
      onNotify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleInspect = async (id: string) => {
    setBusy(`inspect:${id}`)
    try {
      const inspection = await inspectBackup(id)
      setChecked(inspection)
      onNotify('备份校验通过，可以安全恢复', 'success')
    } catch (error) {
      setChecked(null)
      onNotify(`备份检查失败：${errorMessage(error)}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleVerifyAll = async () => {
    setBusy('verify-all')
    let passed = 0
    const broken: string[] = []
    try {
      for (const item of backups) {
        try {
          await inspectBackup(item.id)
          passed += 1
        } catch {
          broken.push(formatTime(item.createdAt))
        }
      }
      if (broken.length === 0) {
        onNotify(`${passed} 份备份全部检查通过，恢复流程可用`, 'success')
      } else {
        onNotify(
          `${passed} 份通过，${broken.length} 份无法读取：${broken.join('、')}`,
          'error',
        )
      }
    } catch (error) {
      onNotify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleRestore = async (id: string) => {
    let inspection = checked?.meta.id === id ? checked : null
    setBusy(`restore:${id}`)
    try {
      if (!inspection) {
        inspection = await inspectBackup(id)
        setChecked(inspection)
      }

      const syncHint = getSyncState().enabled
        ? '同步已开启，恢复后的账本也会同步到另一台设备。'
        : ''
      const confirmed = await confirmDesktopAction(
        `将用 ${formatTime(inspection.meta.createdAt)} 的备份覆盖当前账本（${countText(
          inspection.counts,
        )}）。恢复前会先自动备份当前数据，确定继续吗？${syncHint}`,
        '恢复备份',
      )
      if (!confirmed) return

      // Protect whatever is live before replacing it, even though the user
      // already picked an older snapshot.
      await createBackup('before-restore')
      const applied = applyLedgerDataSnapshot(inspection.snapshot)
      noteLocalRestore(applied)
      window.dispatchEvent(new Event('zhangye:ledger-reloaded'))
      await refresh()
      onNotify('已恢复备份，当前账本已更新', 'success')
    } catch (error) {
      onNotify(`恢复失败：${errorMessage(error)}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async (item: BackupMeta) => {
    const confirmed = await confirmDesktopAction(
      `删除 ${formatTime(item.createdAt)} 的备份？此操作不可撤销。`,
      '删除备份',
    )
    if (!confirmed) return

    setBusy(`delete:${item.id}`)
    try {
      await deleteBackup(item.id)
      if (checked?.meta.id === item.id) setChecked(null)
      await refresh()
      onNotify('备份已删除', 'success')
    } catch (error) {
      onNotify(errorMessage(error), 'error')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="backup-section">
      <div className="backup-head">
        <div>
          <h4>
            <HardDrive size={16} />
            本机自动备份
          </h4>
          <p>
            每次启动检查一次，每天最多保留一份；导入、清空或恢复前也会自动备份。
            最近的备份保留 30 份，另外每天保留一份、最多 14 天，全部只存在本机。
          </p>
        </div>
        <div className="backup-head-actions">
          <button
            type="button"
            className="button ghost small"
            onClick={handleVerifyAll}
            disabled={busy !== null || backups.length === 0}
          >
            <ShieldCheck size={15} />
            全部检查
          </button>
          <button
            type="button"
            className="button primary small"
            onClick={handleCreate}
            disabled={busy !== null}
          >
            <RefreshCw size={15} />
            {busy === 'create' ? '备份中…' : '立即备份'}
          </button>
        </div>
      </div>

      {loading ? (
        <p className="backup-empty">正在读取备份…</p>
      ) : failed ? (
        <p className="backup-empty">无法读取备份列表，请稍后重试。</p>
      ) : backups.length === 0 ? (
        <p className="backup-empty">
          还没有备份。点击「立即备份」保存第一份，之后每天会自动保留一份。
        </p>
      ) : (
        <ul className="backup-list">
          {backups.map((item) => {
            const isChecked = checked?.meta.id === item.id
            return (
              <li
                key={item.id}
                className={`backup-item${isChecked ? ' is-checked' : ''}`}
              >
                <div className="backup-row">
                  <div className="backup-info">
                    <strong>
                      {reasonLabel(item.reason)}
                      {isChecked ? (
                        <span className="backup-ok">
                          <Check size={13} />
                          校验通过
                        </span>
                      ) : null}
                    </strong>
                    <small>
                      <Clock size={12} />
                      {formatTime(item.createdAt)}
                      <span>·</span>
                      {formatBytes(item.bytes)}
                      {item.counts
                        ? ` · ${item.counts.transactions} 笔流水`
                        : ''}
                    </small>
                  </div>
                  <div className="backup-actions">
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => void handleInspect(item.id)}
                      disabled={busy !== null}
                    >
                      {busy === `inspect:${item.id}` ? '检查中…' : '检查'}
                    </button>
                    <button
                      type="button"
                      className="button ghost small"
                      onClick={() => void handleRestore(item.id)}
                      disabled={busy !== null}
                    >
                      <RotateCcw size={14} />
                      {busy === `restore:${item.id}` ? '恢复中…' : '恢复'}
                    </button>
                    <button
                      type="button"
                      className="icon-button danger"
                      onClick={() => void handleDelete(item)}
                      disabled={busy !== null}
                      aria-label="删除备份"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {isChecked && checked ? (
                  <div className="backup-preview">
                    <p>{rangeText(checked)}</p>
                    <p>{countText(checked.counts)}</p>
                    <p>
                      备份时版本 v{checked.meta.appVersion ?? '未知'}，文件{' '}
                      {formatBytes(checked.meta.bytes)}。内容已完整解析，可直接恢复。
                    </p>
                  </div>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
