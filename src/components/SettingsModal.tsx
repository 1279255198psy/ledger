import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import {
  Download,
  FileSpreadsheet,
  Moon,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sun,
  Upload,
  X,
} from 'lucide-react'
import { Modal } from './Modal'
import { formatMoney } from '../lib/utils'
import type { UpdaterController } from '../hooks/useUpdater'
import type { Theme } from '../types'

interface SettingsModalProps {
  open: boolean
  budget: number
  theme: Theme
  updater: UpdaterController
  onClose: () => void
  onBudgetSave: (budget: number) => void
  onThemeChange: (theme: Theme) => void
  onExportJson: () => void
  onExportCsv: () => void
  onImportFile: (file: File) => void
  onReset: () => void
}

export function SettingsModal({
  open,
  budget,
  theme,
  updater,
  onClose,
  onBudgetSave,
  onThemeChange,
  onExportJson,
  onExportCsv,
  onImportFile,
  onReset,
}: SettingsModalProps) {
  const [budgetInput, setBudgetInput] = useState(String(budget))
  const [budgetError, setBudgetError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setBudgetInput(String(budget))
      setBudgetError('')
    }
  }, [open, budget])

  const handleBudgetSubmit = (event: FormEvent) => {
    event.preventDefault()
    const value = Number(budgetInput)
    if (!Number.isFinite(value) || value <= 0) {
      setBudgetError('请输入大于 0 的预算金额')
      return
    }
    setBudgetError('')
    onBudgetSave(Math.round(value))
  }

  const updateInDialog =
    updater.phase === 'checking' ||
    updater.phase === 'available' ||
    updater.phase === 'downloading' ||
    updater.phase === 'ready' ||
    updater.phase === 'installing' ||
    updater.phase === 'error'

  let updateActionTitle = '检查更新'
  let updateActionDetail = '打开更新窗口，检查 GitHub 上的新版本'
  if (updater.phase === 'checking') {
    updateActionTitle = '正在检查更新'
    updateActionDetail = '打开更新窗口查看检查进度'
  } else if (updater.phase === 'available') {
    updateActionTitle = `查看新版本 v${updater.version ?? ''}`
    updateActionDetail = '打开更新窗口，选择立刻更新或下次再说'
  } else if (updater.phase === 'downloading') {
    updateActionTitle = '查看下载进度'
    updateActionDetail = '更新正在后台下载，可以继续记账'
  } else if (updater.phase === 'ready') {
    updateActionTitle = '安装已下载的更新'
    updateActionDetail = '打开更新窗口，选择立即安装或稍后安装'
  } else if (updater.phase === 'installing') {
    updateActionTitle = '正在安装更新'
    updateActionDetail = '安装完成后账页会自动重新打开'
  } else if (updater.phase === 'error') {
    updateActionTitle = '查看更新问题'
    updateActionDetail = '上次更新没有完成，可以打开窗口重试'
  }

  const handleUpdateAction = () => {
    // The update dialog owns the whole flow, so hand the screen over to it.
    onClose()
    if (updateInDialog) {
      updater.openDialog()
    } else {
      void updater.checkForUpdates()
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="settings-modal-title"
      className="settings-modal"
    >
      <header className="modal-header">
        <div>
          <p className="eyebrow">偏好与数据</p>
          <h2 id="settings-modal-title">把账页调成喜欢的样子</h2>
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

      <div className="modal-body settings-body">
        <section className="settings-section">
          <div className="settings-heading">
            <h3>外观</h3>
            <p>为当下的光线选一个舒适的阅读方式。</p>
          </div>
          <div className="theme-switch" role="group" aria-label="主题">
            <button
              type="button"
              className={theme === 'light' ? 'is-active' : ''}
              onClick={() => onThemeChange('light')}
              aria-pressed={theme === 'light'}
            >
              <Sun size={16} />
              浅色纸页
            </button>
            <button
              type="button"
              className={theme === 'dark' ? 'is-active' : ''}
              onClick={() => onThemeChange('dark')}
              aria-pressed={theme === 'dark'}
            >
              <Moon size={16} />
              深色夜读
            </button>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-heading">
            <h3>月度预算</h3>
            <p>给每个月留一条温柔的边界，当前预算 {formatMoney(budget)}。</p>
          </div>
          <form className="budget-form" onSubmit={handleBudgetSubmit}>
            <label className="budget-input">
              <span>¥</span>
              <input
                type="number"
                inputMode="numeric"
                min="1"
                step="1"
                value={budgetInput}
                onChange={(event) => {
                  setBudgetInput(event.target.value)
                  setBudgetError('')
                }}
                aria-label="月度预算金额"
              />
            </label>
            <button type="submit" className="button secondary">
              保存预算
            </button>
          </form>
          {budgetError ? (
            <p className="form-error" role="alert">
              {budgetError}
            </p>
          ) : null}
        </section>

        <section className="settings-section">
          <div className="settings-heading">
            <h3>数据管理</h3>
            <p>备份、迁移，或者重新开始。所有操作都在本地完成。</p>
          </div>
          <div className="data-actions">
            <button type="button" className="data-row" onClick={onExportJson}>
              <span className="data-row-icon">
                <Download size={18} />
              </span>
              <span className="data-row-text">
                <strong>导出完整备份</strong>
                <small>包含全部流水与预算的 JSON 文件</small>
              </span>
            </button>
            <button
              type="button"
              className="data-row"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="data-row-icon">
                <Upload size={18} />
              </span>
              <span className="data-row-text">
                <strong>导入备份</strong>
                <small>从账页导出的 JSON 备份恢复数据</small>
              </span>
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) onImportFile(file)
                event.currentTarget.value = ''
              }}
            />
            <button type="button" className="data-row" onClick={onExportCsv}>
              <span className="data-row-icon">
                <FileSpreadsheet size={18} />
              </span>
              <span className="data-row-text">
                <strong>导出流水表格</strong>
                <small>CSV 格式，可用 Excel 打开</small>
              </span>
            </button>
            <button
              type="button"
              className="data-row data-row--danger"
              onClick={onReset}
            >
              <span className="data-row-icon">
                <RotateCcw size={18} />
              </span>
              <span className="data-row-text">
                <strong>恢复示例账本</strong>
                <small>清除当前数据，载入一组演示流水</small>
              </span>
            </button>
          </div>
          <p className="privacy-note">
            <ShieldCheck size={15} />
            账页没有账号系统，也不会把数据传到任何服务器。
          </p>
        </section>

        <section className="settings-section">
          <div className="settings-heading">
            <h3>关于账页</h3>
            <p>
              {updater.supported
                ? `当前版本 v${updater.currentVersion || '…'}。启动时会自动检查更新，所有下载与安装操作都在更新弹窗中完成。`
                : '自动更新只在使用安装版时可用。'}
            </p>
          </div>

          {updater.supported ? (
            <div className="data-actions">
              <button
                type="button"
                className="data-row"
                onClick={handleUpdateAction}
              >
                <span className="data-row-icon">
                  <RefreshCw
                    size={18}
                    className={
                      updater.phase === 'checking' ? 'is-spinning' : undefined
                    }
                  />
                </span>
                <span className="data-row-text">
                  <strong>{updateActionTitle}</strong>
                  <small>{updateActionDetail}</small>
                </span>
              </button>
            </div>
          ) : null}
        </section>
      </div>
    </Modal>
  )
}
