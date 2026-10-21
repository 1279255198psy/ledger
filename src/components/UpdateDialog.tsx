import type { ReactNode } from 'react'
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  Download,
  LoaderCircle,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react'
import { Modal } from './Modal'
import type { UpdaterController } from '../hooks/useUpdater'

interface UpdateDialogProps {
  updater: UpdaterController
  suspended: boolean
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function UpdateDialog({ updater, suspended }: UpdateDialogProps) {
  const { phase } = updater
  const open =
    updater.dialogOpen && !suspended && phase !== 'idle'
  const percent =
    updater.contentLength && updater.contentLength > 0
      ? Math.min(
          100,
          Math.round(
            (updater.downloadedBytes / updater.contentLength) * 100,
          ),
        )
      : null
  const busy =
    phase === 'checking' || phase === 'downloading' || phase === 'installing'

  const handleClose = () => {
    if (phase === 'installing') return
    updater.dismissDialog()
  }

  let title = ''
  if (phase === 'checking') title = '正在检查新版本'
  else if (phase === 'up-to-date') title = '已经是最新版本'
  else if (phase === 'available') title = `账页 v${updater.version ?? ''} 来了`
  else if (phase === 'downloading') {
    title = `正在下载 v${updater.version ?? ''}`
  } else if (phase === 'ready') title = '新版本已经准备好'
  else if (phase === 'installing') title = '正在安装更新'
  else if (phase === 'error') title = '这次更新没有完成'

  let emblem: ReactNode = null
  if (busy) {
    emblem = <LoaderCircle size={24} className="is-spinning" />
  } else if (phase === 'available') {
    emblem = <Sparkles size={24} />
  } else if (phase === 'ready' || phase === 'up-to-date') {
    emblem = <CircleCheck size={24} />
  } else if (phase === 'error') {
    emblem = <CircleAlert size={24} />
  }

  const bytesLabel =
    updater.downloadedBytes > 0
      ? updater.contentLength
        ? `${formatBytes(updater.downloadedBytes)} / ${formatBytes(updater.contentLength)}`
        : `已下载 ${formatBytes(updater.downloadedBytes)}`
      : null
  const downloadedSize =
    updater.contentLength && updater.contentLength > 0
      ? formatBytes(updater.contentLength)
      : updater.downloadedBytes > 0
        ? formatBytes(updater.downloadedBytes)
        : null

  let footer: ReactNode = null
  if (phase === 'available') {
    footer = (
      <>
        <button
          type="button"
          className="button secondary"
          onClick={updater.dismissDialog}
        >
          下次再说
        </button>
        <button
          type="button"
          className="button primary"
          onClick={() => void updater.startDownload()}
          data-autofocus
        >
          <Download size={15} />
          立刻更新
        </button>
      </>
    )
  } else if (phase === 'downloading') {
    footer = (
      <button
        type="button"
        className="button secondary"
        onClick={updater.backgroundDownload}
        data-autofocus
      >
        后台下载
      </button>
    )
  } else if (phase === 'ready') {
    footer = (
      <>
        <button
          type="button"
          className="button secondary"
          onClick={updater.dismissDialog}
        >
          稍后安装
        </button>
        <button
          type="button"
          className="button primary"
          onClick={() => void updater.installUpdate()}
          data-autofocus
        >
          <Download size={15} />
          立即安装
        </button>
      </>
    )
  } else if (phase === 'checking') {
    footer = (
      <button
        type="button"
        className="button secondary"
        onClick={updater.dismissDialog}
      >
        关闭
      </button>
    )
  } else if (phase === 'up-to-date') {
    footer = (
      <button
        type="button"
        className="button primary"
        onClick={updater.dismissDialog}
        data-autofocus
      >
        知道了
      </button>
    )
  } else if (phase === 'error') {
    footer = (
      <>
        <button
          type="button"
          className="button secondary"
          onClick={updater.dismissDialog}
        >
          关闭
        </button>
        <button
          type="button"
          className="button primary"
          onClick={() => {
            if (updater.errorStage === 'check') {
              void updater.checkForUpdates()
            } else {
              void updater.startDownload()
            }
          }}
          data-autofocus
        >
          {updater.errorStage === 'check' ? '重新检查' : '重新下载'}
        </button>
      </>
    )
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      labelledBy="update-dialog-title"
      className="update-modal"
    >
      <header className="modal-header update-modal-header">
        <div>
          <p className="eyebrow">应用更新</p>
          <h2 id="update-dialog-title">{title}</h2>
        </div>
        {phase !== 'installing' ? (
          <button
            type="button"
            className="icon-button"
            onClick={handleClose}
            aria-label="关闭更新窗口"
          >
            <X size={19} />
          </button>
        ) : null}
      </header>

      <div
        className="modal-body update-modal-body"
        aria-busy={busy || undefined}
      >
        {emblem ? (
          <span
            className={`update-emblem update-emblem--${phase}`}
            aria-hidden="true"
          >
            {emblem}
          </span>
        ) : null}

        {phase === 'checking' ? (
          <p className="update-lead">
            正在读取 GitHub Releases 上的更新清单，通常只需要几秒钟。
          </p>
        ) : null}

        {phase === 'up-to-date' ? (
          <p className="update-lead">
            当前版本 v{updater.currentVersion || '—'} 已经是 GitHub
            上最新的版本。下次启动时，账页还会安静地检查一次。
          </p>
        ) : null}

        {phase === 'available' ? (
          <>
            <div
              className="update-version-path"
              aria-label={`当前版本 ${updater.currentVersion || '未知'}，新版本 ${updater.version ?? '未知'}`}
            >
              <span className="update-version-pill">
                当前 v{updater.currentVersion || '…'}
              </span>
              <ArrowRight size={14} className="update-version-arrow" />
              <span className="update-version-pill is-new">
                新版 v{updater.version ?? '…'}
              </span>
            </div>
            <p className="update-lead">
              这次更新会保留全部账本、预算和外观设置。下载完成后，账页会再问你一次是否现在安装。
            </p>
            {updater.notes ? (
              <div className="update-release-notes">
                <strong>这次更新了什么</strong>
                <p>{updater.notes}</p>
              </div>
            ) : null}
            <p className="update-security-note">
              <ShieldCheck size={13} />
              只从 GitHub Releases 获取更新，安装前校验签名；账目不会上传。
            </p>
          </>
        ) : null}

        {phase === 'downloading' ? (
          <>
            <p className="update-lead">
              下载期间可以继续记账。想先做别的事，就切到后台下载，完成后再回来安装。
            </p>
            <div className="update-progress-block">
              <div className="update-progress-meta">
                <span>
                  {percent === null ? '正在准备更新包…' : `已下载 ${percent}%`}
                </span>
                {bytesLabel ? <span>{bytesLabel}</span> : null}
              </div>
              <div
                className="update-progress"
                role="progressbar"
                aria-label="更新下载进度"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent ?? undefined}
                aria-valuetext={
                  percent === null ? '正在下载' : `已下载 ${percent}%`
                }
              >
                <span
                  className={percent === null ? 'is-indeterminate' : undefined}
                  style={
                    percent === null
                      ? undefined
                      : { width: `${percent}%` }
                  }
                />
              </div>
            </div>
            <p className="update-security-note">
              <ShieldCheck size={13} />
              下载完成后会先校验签名，再询问你是否安装。
            </p>
          </>
        ) : null}

        {phase === 'ready' ? (
          <>
            <p className="update-lead">
              v{updater.version ?? ''} 的安装包已经下载完成并通过签名校验。
            </p>
            <div className="update-ready-card">
              <CircleCheck size={18} />
              <div>
                <strong>可以安装了</strong>
                <span>
                  {downloadedSize ? `${downloadedSize} · ` : ''}
                  安装前会先保存账本
                </span>
              </div>
            </div>
            <p className="update-security-note">
              <ShieldCheck size={13} />
              安装时账页会关闭，完成后自动重新打开，不需要手动操作。
            </p>
          </>
        ) : null}

        {phase === 'installing' ? (
          <>
            <p className="update-lead">
              安装程序已经启动，账页即将关闭。安装完成后会自动打开新版本。
            </p>
            <div className="update-progress update-install-progress">
              <span className="is-indeterminate" />
            </div>
            <p className="update-security-note">
              <ShieldCheck size={13} />
              账本已经写入本机，安装过程不会影响已有数据。
            </p>
          </>
        ) : null}

        {phase === 'error' ? (
          <>
            <p className="update-lead">{updater.error}</p>
            <p className="update-security-note">
              <ShieldCheck size={13} />
              更新失败不会影响已有账本，你仍然可以正常记账。
            </p>
          </>
        ) : null}
      </div>

      {footer ? (
        <footer className="modal-footer update-modal-footer">{footer}</footer>
      ) : null}
    </Modal>
  )
}
