import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Check,
  Copy,
  KeyRound,
  Link2,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wifi,
} from 'lucide-react'
import { SelectMenu } from './SelectMenu'
import { useSync } from '../hooks/useSync'
import { isDesktopApp } from '../lib/desktop'
import { isMobileApp } from '../lib/platform'
import {
  connectMobile,
  disableSync,
  enableDesktopSync,
  refreshDesktopStatus,
  resetPairing,
  resolveDirection,
  resolvePriority,
  setSyncAuto,
  setSyncPriority,
  syncNow,
} from '../lib/sync/engine'
import { formatSyncCode } from '../lib/sync/crypto'
import type { SyncFavor, SyncPriority } from '../lib/sync/types'

const PRIORITY_OPTIONS: Array<{ value: SyncFavor; label: string }> = [
  { value: 'latest', label: '按最后改动时间' },
  { value: 'phone', label: '手机优先' },
  { value: 'desktop', label: '电脑优先' },
]

const PHASE_COPY: Record<string, string> = {
  idle: '待命',
  connecting: '正在连接…',
  merging: '正在合并…',
  pushing: '正在写入…',
  success: '已同步',
  error: '同步失败',
  disabled: '未开启',
}

function formatTime(value: string | null): string {
  if (!value) return '还没有同步过'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '还没有同步过'
  return date.toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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

export function SyncSettingsSection() {
  const sync = useSync()
  const [address, setAddress] = useState(sync.url ?? '')
  const [code, setCode] = useState(sync.code ?? '')
  const [busy, setBusy] = useState(false)
  const [rememberPriority, setRememberPriority] = useState(false)
  const [pendingChoice, setPendingChoice] = useState<SyncFavor>('latest')
  const [notice, setNotice] = useState<{ text: string; kind: 'ok' | 'bad' } | null>(
    null,
  )

  useEffect(() => {
    if (sync.role === 'desktop' && sync.enabled) {
      void refreshDesktopStatus().catch(() => undefined)
    }
  }, [sync.role, sync.enabled])

  useEffect(() => {
    if (sync.pendingPriority) {
      setRememberPriority(false)
      setPendingChoice('latest')
    }
  }, [sync.pendingPriority])

  // The sync engine may finish loading after this section first renders, and a
  // disconnected phone should still see the address it used before.
  useEffect(() => {
    if (sync.enabled) return
    setAddress((current) => current || sync.url || '')
    setCode((current) => current || sync.code || '')
  }, [sync.enabled, sync.url, sync.code])

  const run = async (task: () => Promise<void>, okText?: string) => {
    setBusy(true)
    setNotice(null)
    try {
      await task()
      if (okText) setNotice({ text: okText, kind: 'ok' })
    } catch (error) {
      const message =
        error instanceof Error ? error.message : '操作失败，请再试一次'
      setNotice({ text: message, kind: 'bad' })
    } finally {
      setBusy(false)
    }
  }

  const handleCopy = async (value: string, label: string) => {
    const copied = await copyText(value)
    setNotice({
      text: copied ? `已复制${label}` : '复制失败，请手动输入',
      kind: copied ? 'ok' : 'bad',
    })
  }

  const handleConnect = () =>
    run(async () => {
      await connectMobile(address, code)
    }, '已连接到电脑')

  const handleReset = () => {
    if (
      !window.confirm(
        '更换同步码后，已经连接的手机需要重新输入新码。确定要更换吗？',
      )
    ) {
      return
    }
    void run(async () => {
      await resetPairing()
    }, '同步码已更换')
  }

  const statusLine =
    sync.phase === 'error' && sync.lastError
      ? sync.lastError
      : sync.message || PHASE_COPY[sync.phase] || ''

  if (!sync.ready) {
    return (
      <section className="settings-section sync-section">
        <div className="settings-heading">
          <h3>双端同步</h3>
          <p>正在读取同步设置…</p>
        </div>
      </section>
    )
  }

  if (!isDesktopApp() && !isMobileApp()) {
    return (
      <section className="settings-section sync-section">
        <div className="settings-heading">
          <h3>双端同步</h3>
          <p>双端同步只在电脑版和手机版中可用，请在安装版中打开。</p>
        </div>
      </section>
    )
  }

  return (
    <section className="settings-section sync-section">
      <div className="settings-heading">
        <h3>双端同步</h3>
        <p>
          手机和电脑连同一个 Wi-Fi，就能把账目合并到一起。数据只在两台设备之间
          加密传输，不经过任何服务器。
        </p>
      </div>

      {sync.role === 'desktop' ? (
        <>
          <div className={`sync-panel${sync.enabled ? '' : ' is-off'}`}>
            <div className="sync-master">
              <span className="sync-master-icon" aria-hidden="true">
                <Smartphone size={19} />
              </span>
              <span className="sync-master-copy">
                <strong>手机同步服务</strong>
                <small>
                  {sync.enabled
                    ? sync.running
                      ? `正在 ${sync.port ?? ''} 端口等待手机连接`
                      : '服务未在运行'
                    : '开启后，手机可以在同一 Wi-Fi 下找到这台电脑'}
                </small>
              </span>
              <button
                type="button"
                className={`reminder-switch${sync.enabled ? ' is-on' : ''}`}
                onClick={() =>
                  void run(async () => {
                    if (sync.enabled) await disableSync()
                    else await enableDesktopSync()
                  })
                }
                aria-pressed={sync.enabled}
                aria-label={sync.enabled ? '关闭同步服务' : '开启同步服务'}
                disabled={busy}
              >
                <span className="reminder-switch-knob" />
              </button>
            </div>

            {sync.enabled ? (
              <div className="sync-body">
                <div className="sync-code-block">
                  <span className="sync-label">
                    <KeyRound size={14} /> 同步码
                  </span>
                  <button
                    type="button"
                    className="sync-code"
                    onClick={() =>
                      sync.code
                        ? void handleCopy(sync.code, '同步码')
                        : undefined
                    }
                    title="点击复制同步码"
                  >
                    {sync.code ? formatSyncCode(sync.code) : '—'}
                    <Copy size={15} />
                  </button>
                  <p className="sync-note">
                    手机会用这串码加密数据。只输入给这台电脑，不要发给别人。
                  </p>
                </div>

                <div className="sync-address-block">
                  <span className="sync-label">
                    <Wifi size={14} /> 电脑地址
                  </span>
                  {sync.addresses.length > 0 ? (
                    <div className="sync-address-list">
                      {sync.addresses.map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="sync-address"
                          onClick={() => void handleCopy(item, '地址')}
                          title="点击复制地址"
                        >
                          {item}
                          <Copy size={13} />
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="sync-warning">
                      <AlertCircle size={14} />
                      没有找到局域网地址，请确认电脑已连接 Wi-Fi 或网线。
                    </p>
                  )}
                  <p className="sync-note">
                    在手机上打不开？请允许账页通过 Windows 防火墙的专用网络。
                  </p>
                </div>

                <ol className="sync-steps">
                  <li>手机和电脑连接同一个 Wi-Fi。</li>
                  <li>手机打开账页 → 设置 → 双端同步。</li>
                  <li>输入上面的地址和同步码，点「连接电脑」。</li>
                </ol>

                <div className="sync-actions">
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => void run(() => syncNow())}
                    disabled={busy || !sync.running}
                  >
                    <RefreshCw size={15} />
                    立即同步
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    onClick={handleReset}
                    disabled={busy}
                  >
                    更换同步码
                  </button>
                </div>

                <p className="sync-note">
                  电脑上的改动会自动发布；手机停留在账页界面时会在几秒内收到。
                </p>

                <p className="sync-meta">
                  最近同步：{formatTime(sync.lastSyncAt)}
                  {sync.lastPeerAt
                    ? ` · 手机上次连接：${formatTime(sync.lastPeerAt)}`
                    : ''}
                </p>
              </div>
            ) : null}
          </div>
          <p className="privacy-note">
            <ShieldCheck size={15} />
            数据用同步码派生的 AES-256-GCM 密钥加密，电脑只负责中转密文。
          </p>
        </>
      ) : (
        <>
          {sync.pendingPriority ? (
            <div className="sync-direction sync-priority">
              <div className="sync-direction-head">
                <strong>这次连接，冲突时以哪边为准？</strong>
                <p>
                  只会影响同一笔记录在两边都被改过的情况，未冲突的改动都会保留，
                  不会整份覆盖。
                </p>
              </div>
              <div className="sync-priority-picker">
                <SelectMenu
                  value={pendingChoice}
                  options={PRIORITY_OPTIONS}
                  onChange={(value) => setPendingChoice(value as SyncFavor)}
                  ariaLabel="冲突时以哪边为准"
                  className="sync-select-menu"
                  elevated
                />
                <button
                  type="button"
                  className="button primary"
                  onClick={() =>
                    resolvePriority(pendingChoice, rememberPriority)
                  }
                >
                  按这个方案同步
                </button>
              </div>
              <p className="sync-priority-hint">
                「按最后改动时间」比较的是最后一次编辑记录的时间，不是账目日期。
              </p>
              <label className="sync-remember">
                <input
                  type="checkbox"
                  checked={rememberPriority}
                  onChange={(event) =>
                    setRememberPriority(event.target.checked)
                  }
                />
                记住这次选择，以后不再询问
              </label>
              <button
                type="button"
                className="sync-cancel-link"
                onClick={() => resolvePriority('cancel')}
              >
                取消连接
              </button>
            </div>
          ) : null}

          {sync.pendingDirection ? (
            <div className="sync-direction">
              <div className="sync-direction-head">
                <strong>第一次同步，要保留哪边的账目？</strong>
                <p>
                  手机上 {sync.pendingDirection.localCount} 条记录，电脑上{' '}
                  {sync.pendingDirection.remoteCount} 条记录。合并会把两边都保留，
                  相同记录会自动去重。
                </p>
              </div>
              <div className="sync-direction-actions">
                <button
                  type="button"
                  className="button primary"
                  onClick={() => resolveDirection('merge')}
                >
                  合并两边
                </button>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => resolveDirection('remote')}
                >
                  以电脑为准
                </button>
                <button
                  type="button"
                  className="button ghost"
                  onClick={() => resolveDirection('local')}
                >
                  以手机为准
                </button>
              </div>
            </div>
          ) : null}

          {sync.enabled ? (
            <div className="sync-panel">
              <div className="sync-master">
                <span className="sync-master-icon" aria-hidden="true">
                  <Link2 size={19} />
                </span>
                <span className="sync-master-copy">
                  <strong>{sync.url?.replace(/^https?:\/\//, '')}</strong>
                  <small>
                    最近同步：{formatTime(sync.lastSyncAt)}
                    {sync.lastError ? ` · ${sync.lastError}` : ''}
                  </small>
                </span>
                <span
                  className={`sync-badge is-${sync.phase}`}
                  title={statusLine}
                >
                  {sync.phase === 'success' ? <Check size={13} /> : null}
                  {PHASE_COPY[sync.phase] ?? sync.phase}
                </span>
              </div>

              <div className="sync-body">
                <div className="sync-inline">
                  <span className="sync-label">自动同步</span>
                  <button
                    type="button"
                    className={`reminder-switch reminder-switch--small${
                      sync.auto ? ' is-on' : ''
                    }`}
                    onClick={() => void setSyncAuto(!sync.auto)}
                    aria-pressed={sync.auto}
                    aria-label={sync.auto ? '关闭自动同步' : '开启自动同步'}
                  >
                    <span className="reminder-switch-knob" />
                  </button>
                </div>
                <p className="sync-note">
                  打开账页、回到前台、记账后会自动同步；停留在账页时也会定期检查电脑上的改动。
                </p>

                <div className="sync-inline">
                  <span className="sync-label">冲突时</span>
                  <SelectMenu
                    value={sync.priority}
                    options={[
                      { value: 'ask', label: '每次连接时询问' },
                      ...PRIORITY_OPTIONS,
                    ]}
                    onChange={(value) =>
                      setSyncPriority(value as SyncPriority)
                    }
                    ariaLabel="两边都改过同一笔记录时以哪边为准"
                    className="sync-select-menu"
                    elevated
                  />
                </div>
                <p className="sync-note">
                  「按最后改动时间」比较的是最后一次编辑记录的时间，不是账目日期；
                  未冲突的改动始终都会保留。
                </p>
                {sync.priority === 'ask' ? (
                  <p className="sync-note">
                    如果不想每次连接都被询问，可以把「冲突时」改为「按最后改动时间」。
                  </p>
                ) : null}

                <div className="sync-actions">
                  <button
                    type="button"
                    className="button primary"
                    onClick={() => void run(() => syncNow())}
                    disabled={busy || sync.pendingDirection !== null}
                  >
                    <RefreshCw size={15} />
                    {busy ? '同步中…' : '立即同步'}
                  </button>
                  <button
                    type="button"
                    className="button ghost"
                    onClick={() => void run(() => disableSync())}
                    disabled={busy}
                  >
                    断开电脑
                  </button>
                </div>

                <p className="sync-meta">
                  同步码：{sync.code ? formatSyncCode(sync.code) : '—'} ·
                  {sync.hasBase ? ' 已建立同步基线' : ' 等待首次同步'}
                </p>
              </div>
            </div>
          ) : (
            <div className="sync-panel">
              <div className="sync-form">
                <label className="sync-field">
                  <span className="sync-label">电脑地址</span>
                  <input
                    type="text"
                    inputMode="url"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="192.168.1.5:47821"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                  />
                </label>
                <label className="sync-field">
                  <span className="sync-label">同步码</span>
                  <input
                    type="text"
                    inputMode="text"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                    placeholder="XXXXX-XXXXX"
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="button primary sync-connect"
                  onClick={handleConnect}
                  disabled={busy || !address.trim() || !code.trim()}
                >
                  {busy ? '正在连接…' : '连接电脑'}
                </button>
              </div>
              <p className="sync-note">
                地址和同步码在电脑版「设置 → 双端同步」里可以看到。
              </p>
            </div>
          )}

          <p className="privacy-note">
            <ShieldCheck size={15} />
            两台设备必须在同一个 Wi-Fi 下，数据不会离开这个局域网。
          </p>
        </>
      )}

      {notice ? (
        <p className={`sync-notice${notice.kind === 'bad' ? ' is-bad' : ''}`}>
          {notice.text}
        </p>
      ) : null}
    </section>
  )
}
