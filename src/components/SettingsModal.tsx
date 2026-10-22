import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import {
  Archive,
  Check,
  Download,
  FileSpreadsheet,
  FolderPlus,
  Moon,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sun,
  Upload,
  X,
} from 'lucide-react'
import { Modal } from './Modal'
import { formatMoney, localDateKey } from '../lib/utils'
import { CURRENCIES, getCurrency } from '../lib/currency'
import { FONT_SIZES } from '../lib/fontSize'
import { PALETTES } from '../lib/themes'
import type { UpdaterController } from '../hooks/useUpdater'
import type {
  Currency,
  FontSize,
  Palette,
  Project,
  ProjectDraft,
  Theme,
} from '../types'

interface SettingsModalProps {
  open: boolean
  budget: number
  theme: Theme
  palette: Palette
  fontSize: FontSize
  currency: Currency
  projects: Project[]
  updater: UpdaterController
  onClose: () => void
  onBudgetSave: (budget: number) => void
  onThemeChange: (theme: Theme) => void
  onPaletteChange: (palette: Palette) => void
  onFontSizeChange: (fontSize: FontSize) => void
  onCurrencyChange: (currency: Currency) => void
  onCreateProject: (draft: ProjectDraft) => void
  onToggleProjectStatus: (id: string) => void
  onToggleProjectArchive: (id: string) => void
  onExportJson: () => void
  onExportCsv: () => void
  onImportFile: (file: File) => void
  onReset: () => void
}

export function SettingsModal({
  open,
  budget,
  theme,
  palette,
  fontSize,
  currency,
  projects,
  updater,
  onClose,
  onBudgetSave,
  onThemeChange,
  onPaletteChange,
  onFontSizeChange,
  onCurrencyChange,
  onCreateProject,
  onToggleProjectStatus,
  onToggleProjectArchive,
  onExportJson,
  onExportCsv,
  onImportFile,
  onReset,
}: SettingsModalProps) {
  const [budgetInput, setBudgetInput] = useState(String(budget))
  const [budgetError, setBudgetError] = useState('')
  const [projectName, setProjectName] = useState('')
  const [projectStartDate, setProjectStartDate] = useState(localDateKey())
  const [projectBudget, setProjectBudget] = useState('')
  const [projectError, setProjectError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setBudgetInput(String(budget))
      setBudgetError('')
    }
  }, [open, budget])

  useEffect(() => {
    if (open) {
      setProjectName('')
      setProjectStartDate(localDateKey())
      setProjectBudget('')
      setProjectError('')
    }
  }, [open])

  const handleProjectSubmit = (event: FormEvent) => {
    event.preventDefault()
    const name = projectName.trim()
    if (!name) {
      setProjectError('请给项目起一个名字')
      return
    }
    if (!projectStartDate) {
      setProjectError('请选择项目开始日期')
      return
    }
    const budgetValue =
      projectBudget.trim() === '' ? undefined : Number(projectBudget)
    if (
      budgetValue !== undefined &&
      (!Number.isFinite(budgetValue) || budgetValue < 0)
    ) {
      setProjectError('项目预算需要是大于等于 0 的金额')
      return
    }

    setProjectError('')
    onCreateProject({
      name,
      startDate: projectStartDate,
      ...(budgetValue !== undefined && budgetValue > 0
        ? { budgetCents: Math.round(budgetValue * 100) }
        : {}),
    })
    setProjectName('')
    setProjectBudget('')
  }

  const sortedProjects = [...projects].sort((left, right) => {
    const archived = Number(Boolean(left.archivedAt)) - Number(Boolean(right.archivedAt))
    if (archived !== 0) return archived
    const status = Number(left.status === 'closed') - Number(right.status === 'closed')
    if (status !== 0) return status
    return right.updatedAt.localeCompare(left.updatedAt)
  })

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
            <p>为当下的光线选一个舒适的阅读方式，再挑一套相配的主题。</p>
          </div>
          <div className="theme-switch" role="group" aria-label="明暗模式">
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
          <div className="font-size-group">
            <p className="palette-group-label">字体大小</p>
            <div className="font-size-switch" role="radiogroup" aria-label="字体大小">
              {FONT_SIZES.map((item) => {
                const active = item.id === fontSize
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={active ? 'is-active' : ''}
                    onClick={() => onFontSizeChange(item.id)}
                  >
                    {item.name}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="palette-group">
            <p className="palette-group-label">主题</p>
            <div className="palette-grid" role="radiogroup" aria-label="主题">
              {PALETTES.map((item) => {
                const preview = item.preview[theme]
                const active = item.id === palette
                const previewStyle = {
                  '--p-page': preview.page,
                  '--p-surface': preview.surface,
                  '--p-accent': preview.accent,
                  '--p-ink': preview.ink,
                  '--p-hero': preview.hero,
                  '--p-on': preview.on,
                  '--p-income': preview.income,
                  '--p-expense': preview.expense,
                  '--p-trend': preview.trend,
                } as CSSProperties
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={`${item.name}主题`}
                    className={`palette-option${active ? ' is-active' : ''}`}
                    style={previewStyle}
                    onClick={() => onPaletteChange(item.id)}
                  >
                    <span
                      className="palette-preview"
                      data-preview-palette={item.id}
                      aria-hidden="true"
                    >
                      <span className="palette-preview-weave" />
                      <span className="palette-preview-hero">
                        <span className="palette-preview-ornament" />
                      </span>
                      <span className="palette-preview-sheet">
                        <i />
                        <i />
                        <span className="palette-preview-dots">
                          <b />
                          <b />
                          <b />
                        </span>
                      </span>
                    </span>
                    <span className="palette-option-copy">
                      <span className="palette-option-name">{item.name}</span>
                      <span className="palette-option-caption">
                        {item.caption}
                      </span>
                    </span>
                    {active ? (
                      <span className="palette-check" aria-hidden="true">
                        <Check size={10} strokeWidth={3} />
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-heading">
            <h3>货币</h3>
            <p>选择记账使用的货币。切换只更换金额符号，不会换算已有金额。</p>
          </div>
          <div className="currency-grid" role="radiogroup" aria-label="货币">
            {CURRENCIES.map((item) => {
              const active = item.id === currency
              return (
                <button
                  key={item.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={`${item.name}（${item.code}）`}
                  className={`currency-option${active ? ' is-active' : ''}`}
                  onClick={() => onCurrencyChange(item.id)}
                >
                  <span className="currency-symbol" aria-hidden="true">
                    {item.symbol}
                  </span>
                  <span className="currency-name">{item.name}</span>
                  <span className="currency-code">{item.code}</span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="settings-section">
          <div className="settings-heading">
            <h3>月度预算</h3>
            <p>
              给日常生活留一条温柔的边界，当前预算 {formatMoney(budget)}
              。项目支出单独归集，不占生活预算。
            </p>
          </div>
          <form className="budget-form" onSubmit={handleBudgetSubmit}>
            <label className="budget-input">
              <span>{getCurrency(currency).symbol}</span>
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
            <h3>项目</h3>
            <p>
              项目是支出的一种归属，不另立一本账。结束或归档项目不会删除已归集的历史流水。
            </p>
          </div>

          <form className="project-form" onSubmit={handleProjectSubmit}>
            <label className="field project-name-field">
              <span className="field-label">项目名称</span>
              <input
                type="text"
                value={projectName}
                onChange={(event) => {
                  setProjectName(event.target.value)
                  setProjectError('')
                }}
                placeholder="例如：杭州客户网站"
                maxLength={40}
              />
            </label>
            <label className="field">
              <span className="field-label">开始日期</span>
              <input
                type="date"
                value={projectStartDate}
                max={localDateKey()}
                onChange={(event) => setProjectStartDate(event.target.value)}
              />
            </label>
            <label className="field">
              <span className="field-label">
                预算 <span className="optional">选填</span>
              </span>
              <input
                type="number"
                inputMode="decimal"
                min="0"
                step="1"
                value={projectBudget}
                onChange={(event) => {
                  setProjectBudget(event.target.value)
                  setProjectError('')
                }}
                placeholder="0"
              />
            </label>
            <button type="submit" className="button secondary project-create">
              <FolderPlus size={15} />
              新建
            </button>
          </form>

          {projectError ? (
            <p className="form-error" role="alert">
              {projectError}
            </p>
          ) : null}

          {sortedProjects.length === 0 ? (
            <p className="project-empty">
              还没有项目。新建之后，记账时就能把一笔支出归到项目上。
            </p>
          ) : (
            <div className="project-list">
              {sortedProjects.map((project) => {
                const archived = Boolean(project.archivedAt)
                return (
                  <div className="project-row" key={project.id}>
                    <div className="project-row-main">
                      <strong>
                        <span className="project-row-name">{project.name}</span>
                        <span
                          className={`project-status is-${archived ? 'archived' : project.status}`}
                        >
                          {archived
                            ? '已归档'
                            : project.status === 'active'
                              ? '进行中'
                              : '已结束'}
                        </span>
                      </strong>
                      <small>
                        {project.startDate}
                        {project.endDate ? ` → ${project.endDate}` : ''}
                        {project.budgetCents
                          ? ` · 预算 ${formatMoney(project.budgetCents / 100)}`
                          : ''}
                      </small>
                    </div>
                    <div className="project-row-actions">
                      {archived ? (
                        <button
                          type="button"
                          onClick={() => onToggleProjectArchive(project.id)}
                        >
                          恢复
                        </button>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onToggleProjectStatus(project.id)}
                          >
                            {project.status === 'active' ? (
                              <>
                                <Pause size={12} />
                                结束
                              </>
                            ) : (
                              <>
                                <Play size={12} />
                                重启
                              </>
                            )}
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggleProjectArchive(project.id)}
                          >
                            <Archive size={12} />
                            归档
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
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
                ? `当前版本 v${updater.currentVersion || '…'}。启动后会自动检查更新，失败时自动重试并在后台定期复查；所有下载与安装操作都在更新弹窗中完成。`
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
