import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import {
  captureSupported,
  clearCaptureEvents,
  getCaptureDiagnostics,
  getCaptureStatus,
  listCaptureCandidateApps,
  listCaptureEvents,
  openCaptureSettings,
  reconnectCaptureListener,
  setCaptureConfig,
} from '../lib/capture/native'
import {
  loadKeepSamples,
  maskSampleText,
  saveKeepSamples,
} from '../lib/capture/prefs'
import type {
  CaptureAppInfo,
  CaptureDiagnostics,
  CaptureEventRecord,
  CaptureStatus,
} from '../lib/capture/types'

const POLL_MS = 4000

function formatClock(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function sortedEventsForCopy(events: CaptureEventRecord[]): CaptureEventRecord[] {
  return [...events].reverse()
}

function eventCopyText(event: CaptureEventRecord): string {
  return [
    `${event.appLabel} (${event.packageName})`,
    formatClock(event.postedAt),
    event.title,
    event.bigText || event.text,
    event.subText,
  ]
    .filter((line) => line && line.trim().length > 0)
    .join('\n')
}

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    try {
      const input = document.createElement('textarea')
      input.value = value
      input.style.position = 'fixed'
      input.style.opacity = '0'
      document.body.appendChild(input)
      input.select()
      const copied = document.execCommand('copy')
      document.body.removeChild(input)
      return copied
    } catch {
      return false
    }
  }
}

/**
 * Phase 0 of automatic bookkeeping. It only proves the Android listener can
 * see payment notices and lets the user export the raw text; parsing rules come
 * after there are real samples from this phone.
 */
export function CaptureDebugSection() {
  const supported = captureSupported()
  const [status, setStatus] = useState<CaptureStatus | null>(null)
  const [diagnostics, setDiagnostics] = useState<CaptureDiagnostics | null>(null)
  const [apps, setApps] = useState<CaptureAppInfo[]>([])
  const [events, setEvents] = useState<CaptureEventRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [packageDraft, setPackageDraft] = useState('')
  const [keepSamples, setKeepSamples] = useState(() => loadKeepSamples())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const copiedTimer = useRef<number | null>(null)

  /** Cheap refresh: only the permission state and the captured samples. */
  const loadLive = useCallback(async () => {
    if (!supported) return
    try {
      const [nextStatus, nextEvents, nextDiagnostics] = await Promise.all([
        getCaptureStatus(),
        listCaptureEvents(),
        getCaptureDiagnostics(),
      ])
      setStatus(nextStatus)
      setEvents(nextEvents)
      setDiagnostics(nextDiagnostics)
      setError('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取捕获状态失败')
    }
  }, [supported])

  /** Full refresh, including the installed finance apps. */
  const loadAll = useCallback(async () => {
    if (!supported) return
    setLoading(true)
    try {
      const [nextApps] = await Promise.all([
        listCaptureCandidateApps(),
        loadLive(),
      ])
      setApps(nextApps)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '读取应用列表失败')
    } finally {
      setLoading(false)
    }
  }, [loadLive, supported])

  useEffect(() => {
    if (!supported) return
    void loadAll()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadLive()
    }, POLL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void loadAll()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    }
  }, [loadAll, loadLive, supported])

  const applyPackages = async (packages: string[]) => {
    setBusy(true)
    setNotice('')
    try {
      await setCaptureConfig({ packages })
      await loadAll()
      setNotice('监听列表已更新')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存监听列表失败')
    } finally {
      setBusy(false)
    }
  }

  const togglePackage = (packageName: string) => {
    if (!status || busy) return
    const packages = status.packages.includes(packageName)
      ? status.packages.filter((item) => item !== packageName)
      : [...status.packages, packageName]
    void applyPackages(packages)
  }

  const handleAddPackage = (event: FormEvent) => {
    event.preventDefault()
    const value = packageDraft.trim()
    if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(value)) {
      setError('请输入有效的包名，例如 cmb.pb')
      return
    }
    if (status?.packages.includes(value)) {
      setNotice('这个包名已经在监听列表里')
      return
    }
    void applyPackages([...(status?.packages ?? []), value])
    setPackageDraft('')
  }

  const handleAuthorize = async () => {
    setNotice('')
    try {
      await openCaptureSettings()
      setNotice('已打开系统设置：找到「账页」，允许通知使用权，然后返回本页')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '无法打开系统设置')
    }
  }

  /** Some ROMs keep the permission but never rebind the listener on their own. */
  const handleReconnect = async () => {
    setNotice('')
    try {
      await reconnectCaptureListener()
      await loadLive()
      setNotice('已请求系统重新连接监听服务，几秒后再看诊断状态')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '重新连接失败')
    }
  }

  const handleCopy = async (event: CaptureEventRecord) => {
    const ok = await copyText(eventCopyText(event))
    if (!ok) {
      setError('复制失败，请长按文本手动复制')
      return
    }
    setCopiedId(event.id)
    if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
    copiedTimer.current = window.setTimeout(() => setCopiedId(null), 1500)
  }

  const handleCopyAll = async () => {
    const text = sortedEventsForCopy(events).map(eventCopyText).join('\n\n— — —\n\n')
    const ok = await copyText(text)
    setNotice(ok ? '已复制全部样本，可以直接粘贴反馈' : '复制失败')
  }

  /** Safe to share: the wording survives, every digit becomes a bullet. */
  const handleCopyMasked = async () => {
    const text = sortedEventsForCopy(events)
      .map((event) => maskSampleText(eventCopyText(event)))
      .join('\n\n— — —\n\n')
    const ok = await copyText(text)
    setNotice(
      ok
        ? '已复制脱敏样本：数字都换成了 •，可以直接粘贴反馈'
        : '复制失败',
    )
  }

  const toggleKeepSamples = () => {
    const next = !keepSamples
    setKeepSamples(next)
    saveKeepSamples(next)
    setNotice(
      next
        ? '已开启样本保留：之后收到的通知会留在本页'
        : '已关闭样本保留：读取后的通知会立即清理',
    )
  }

  const handleClear = async () => {
    if (!window.confirm('清空所有已捕获的通知样本？这个操作无法撤销。')) return
    setBusy(true)
    setNotice('')
    try {
      await clearCaptureEvents()
      await loadAll()
      setNotice('已清空捕获记录')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '清空失败')
    } finally {
      setBusy(false)
    }
  }

  if (!supported) {
    return (
      <section className="settings-section capture-section">
        <div className="settings-heading">
          <h3>自动记账</h3>
          <p>通知捕获仅在 Android 版可用。</p>
        </div>
      </section>
    )
  }

  const granted = status?.granted ?? false
  const sortedEvents = [...events].reverse()

  return (
    <section className="settings-section capture-section">
      <div className="settings-heading">
        <h3>自动记账（调试）</h3>
        <p>
          确认账页能读到微信、支付宝和银行 App
          的付款通知，并在解析结果不对时导出样本校准。样本只保存在这台手机上，不会上传，也不会进入同步。
        </p>
      </div>

      <div className={`capture-status${granted ? ' is-ok' : ''}`}>
        <span className="capture-status-icon" aria-hidden="true">
          {granted ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
        </span>
        <span className="capture-status-copy">
          <strong>{granted ? '通知使用权已开启' : '还没有开启通知使用权'}</strong>
          <small>
            {granted
              ? status?.connected
                ? `监听服务运行中，已保存 ${status?.count ?? 0} 条样本`
                : '已授权，等待系统连接监听服务（返回本页或重新打开账页）'
              : '账页只能读取通知内容来识别付款，不能修改或拦截通知'}
          </small>
        </span>
        <button
          type="button"
          className="button ghost"
          onClick={() => void handleAuthorize()}
        >
          {granted ? '系统设置' : '去授权'}
        </button>
      </div>

      <p className="capture-note">
        <ShieldCheck size={13} />
        解析全部在本机完成；后续只会把确认后的账目送入账本。
      </p>

      {error ? <p className="capture-message is-error">{error}</p> : null}
      {notice ? <p className="capture-message">{notice}</p> : null}

      <div className="capture-block">
        <div className="capture-head">
          <p className="capture-label">监听诊断</p>
          <div className="capture-actions">
            <button
              type="button"
              className="button ghost"
              onClick={() => void handleReconnect()}
            >
              <RefreshCw size={13} />
              重新连接
            </button>
          </div>
        </div>
        <p className="capture-note">
          这里统计监听服务从每个 App 实际收到的通知条数，用来区分「一条都没收到」和「收到了但被规则过滤」。没勾选的应用如果发来像付款的通知，也会列在这里，可以直接加入监听。
        </p>
        {granted && !status?.connected ? (
          <p className="capture-message is-error">
            通知使用权已开启，但系统还没把监听服务连上。先点「重新连接」；仍然不行，就到系统设置里把账页的通知使用权关掉再打开。
          </p>
        ) : null}
        <div className="capture-diag">
          {(diagnostics?.entries ?? []).map((entry) => {
            const watched = status?.packages.includes(entry.packageName) ?? false
            return (
            <div key={entry.packageName} className="capture-diag-row">
              <div className="capture-diag-head">
                <strong>{entry.label}</strong>
                <small>{entry.packageName}</small>
                {!watched ? (
                  <button
                    type="button"
                    className="button ghost capture-diag-add"
                    disabled={busy}
                    onClick={() =>
                      void applyPackages([
                        ...(status?.packages ?? []),
                        entry.packageName,
                      ])
                    }
                  >
                    加入监听
                  </button>
                ) : null}
              </div>
              {entry.seen === 0 ? (
                <p className="capture-diag-text is-warn">
                  监听服务还没收到这个 App 的任何通知。
                </p>
              ) : (
                <>
                  <p className="capture-diag-text">
                    收到 {entry.seen} 条 · 进入样本 {entry.accepted} 条 · 最近{' '}
                    {formatClock(entry.lastSeen)}
                  </p>
                  {entry.lastReason ? (
                    <p className="capture-diag-text is-warn">
                      最近一条被过滤：{entry.lastReason}
                    </p>
                  ) : null}
                  {entry.lastText ? (
                    <p className="capture-diag-sample">{entry.lastText}</p>
                  ) : null}
                </>
              )}
            </div>
            )
          })}
        </div>
        {diagnostics && diagnostics.entries.every((entry) => entry.seen === 0) ? (
          <p className="capture-note">
            所有 App 都是 0 条时，问题在监听服务本身，不在解析规则：确认系统「通知使用权」里开着账页，并把账页加入电池优化白名单、允许自启动（小米、华为、OPPO、vivo 等机型需要）。
          </p>
        ) : null}
      </div>

      <div className="capture-block">
        <p className="capture-label">监听的应用</p>
        <div className="capture-app-list">
          {apps.map((app) => {
            const active = status?.packages.includes(app.packageName) ?? false
            return (
              <button
                key={app.packageName}
                type="button"
                className={`capture-app${active ? ' is-on' : ''}`}
                aria-pressed={active}
                disabled={busy}
                onClick={() => togglePackage(app.packageName)}
              >
                <span className="capture-app-check" aria-hidden="true">
                  {active ? <Check size={12} /> : null}
                </span>
                <span className="capture-app-copy">
                  <strong>{app.label}</strong>
                  <small>{app.packageName}</small>
                </span>
              </button>
            )
          })}
        </div>
        {apps.length === 0 ? (
          <p className="capture-empty">
            没有发现可选的支付或银行应用，可以在下面手动添加包名。
          </p>
        ) : null}

        <form className="capture-add" onSubmit={handleAddPackage}>
          <input
            value={packageDraft}
            onChange={(event) => setPackageDraft(event.target.value)}
            placeholder="手动添加包名，例如 cmb.pb"
            aria-label="手动添加包名"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="button ghost"
            disabled={busy || packageDraft.trim().length === 0}
          >
            <Plus size={14} />
            添加
          </button>
        </form>
      </div>

      <div className="capture-block">
        <div className="capture-head">
          <p className="capture-label">样本保留</p>
          <button
            type="button"
            className={`button ${keepSamples ? 'primary' : 'ghost'}`}
            aria-pressed={keepSamples}
            onClick={toggleKeepSamples}
          >
            {keepSamples ? '已开启' : '开启'}
          </button>
        </div>
        <p className="capture-note">
          校准解析时打开：收到的通知原文会留在本页，方便导出。
          关闭后，读进账本的通知会立即从本机清理。两种情况下样本都不会上传。
        </p>
      </div>

      <div className="capture-block">
        <div className="capture-head">
          <p className="capture-label">最近的捕获（{events.length}）</p>
          <div className="capture-actions">
            <button
              type="button"
              className="button ghost"
              onClick={() => void handleCopyMasked()}
              disabled={events.length === 0}
            >
              <ShieldCheck size={13} />
              复制脱敏
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => void handleCopyAll()}
              disabled={events.length === 0}
            >
              <Copy size={13} />
              复制全部
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => void loadAll()}
              disabled={loading}
            >
              <RefreshCw size={13} />
              {loading ? '刷新中…' : '刷新'}
            </button>
            <button
              type="button"
              className="button ghost"
              onClick={() => void handleClear()}
              disabled={busy || events.length === 0}
            >
              <Trash2 size={13} />
              清空
            </button>
          </div>
        </div>

        {sortedEvents.length === 0 ? (
          <p className="capture-empty">
            还没有可显示的样本。开启权限、勾选微信/支付宝/银行 App
            并打开上面的「样本保留」后，付一笔小额款项，原文就会出现在这里；否则通知读进账本后就会被清理。
          </p>
        ) : (
          <div className="capture-events">
            {sortedEvents.map((event) => (
              <article key={event.id} className="capture-event">
                <header className="capture-event-head">
                  <span className="capture-event-app">
                    {event.appLabel || event.packageName}
                  </span>
                  <span className="capture-event-time">
                    {formatClock(event.postedAt)}
                  </span>
                  <button
                    type="button"
                    className="icon-button capture-event-copy"
                    onClick={() => void handleCopy(event)}
                    aria-label="复制通知原文"
                  >
                    {copiedId === event.id ? (
                      <Check size={13} />
                    ) : (
                      <Copy size={13} />
                    )}
                  </button>
                </header>
                {event.title ? (
                  <strong className="capture-event-title">{event.title}</strong>
                ) : null}
                <p className="capture-event-text">
                  {event.bigText || event.text || '（无正文）'}
                </p>
                {event.subText ? (
                  <p className="capture-event-sub">{event.subText}</p>
                ) : null}
                <small className="capture-event-package">
                  {event.packageName}
                </small>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
