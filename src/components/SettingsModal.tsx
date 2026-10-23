import { useEffect, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  Database,
  Download,
  ExternalLink,
  FileSpreadsheet,
  Github,
  Info,
  Moon,
  Palette as PaletteIcon,
  PiggyBank,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Sun,
  Tag,
  Tags,
  Trash2,
  Upload,
  Wallet,
  X,
} from 'lucide-react'
import { Modal } from './Modal'
import { CategorySettings } from './CategorySettings'
import {
  GITHUB_RELEASES_URL,
  GITHUB_REPO_URL,
} from '../lib/github'
import { openExternalUrl } from '../lib/links'
import { formatMoney } from '../lib/utils'
import { CURRENCIES, getCurrency } from '../lib/currency'
import { FONT_SIZES } from '../lib/fontSize'
import { PALETTES } from '../lib/themes'
import type { CategoryDraft } from '../lib/categories'
import type { UpdaterController } from '../hooks/useUpdater'
import type {
  Category,
  Currency,
  FontSize,
  Palette,
  Theme,
} from '../types'

interface SettingsModalProps {
  open: boolean
  focusSection: 'opening-balance' | null
  budget: number
  openingBalance: number
  theme: Theme
  palette: Palette
  fontSize: FontSize
  currency: Currency
  categories: Category[]
  categoryTransactionUsage: Record<string, number>
  categoryProjectUsage: Record<string, number>
  updater: UpdaterController
  onClose: () => void
  onBudgetSave: (budget: number) => void
  onOpeningBalanceSave: (balance: number) => void
  onCreateCategory: (draft: CategoryDraft) => void
  onUpdateCategory: (id: string, draft: CategoryDraft) => void
  onDeleteCategory: (id: string) => void
  onThemeChange: (theme: Theme) => void
  onPaletteChange: (palette: Palette) => void
  onFontSizeChange: (fontSize: FontSize) => void
  onCurrencyChange: (currency: Currency) => void
  onExportJson: () => void
  onExportCsv: () => void
  onImportFile: (file: File) => void
  onReset: () => void
  onClear: () => void
}

type SettingsPageId =
  | 'appearance'
  | 'currency'
  | 'categories'
  | 'opening'
  | 'budget'
  | 'data'
  | 'about'

interface SettingsPageMeta {
  id: SettingsPageId
  label: string
  detail: string
  icon: typeof Sun
}

const SETTINGS_PAGES: SettingsPageMeta[] = [
  {
    id: 'appearance',
    label: '外观',
    detail: '明暗模式、字体与主题',
    icon: PaletteIcon,
  },
  {
    id: 'currency',
    label: '货币',
    detail: '记账使用的货币符号',
    icon: Coins,
  },
  {
    id: 'categories',
    label: '分类',
    detail: '管理收入、支出与小分类',
    icon: Tags,
  },
  {
    id: 'opening',
    label: '起始资金',
    detail: '总结余从哪里开始',
    icon: Wallet,
  },
  {
    id: 'budget',
    label: '月度预算',
    detail: '给日常支出留一条边界',
    icon: PiggyBank,
  },
  {
    id: 'data',
    label: '数据管理',
    detail: '备份、导入与重新开始',
    icon: Database,
  },
  {
    id: 'about',
    label: '关于账页',
    detail: '版本、更新与 GitHub',
    icon: Info,
  },
]

export function SettingsModal({
  open,
  focusSection,
  budget,
  openingBalance,
  theme,
  palette,
  fontSize,
  currency,
  categories,
  categoryTransactionUsage,
  categoryProjectUsage,
  updater,
  onClose,
  onBudgetSave,
  onOpeningBalanceSave,
  onCreateCategory,
  onUpdateCategory,
  onDeleteCategory,
  onThemeChange,
  onPaletteChange,
  onFontSizeChange,
  onCurrencyChange,
  onExportJson,
  onExportCsv,
  onImportFile,
  onReset,
  onClear,
}: SettingsModalProps) {
  const [page, setPage] = useState<SettingsPageId | null>(null)
  const [budgetInput, setBudgetInput] = useState(String(budget))
  const [budgetError, setBudgetError] = useState('')
  const [openingMode, setOpeningMode] = useState<'zero' | 'existing'>(
    openingBalance > 0 ? 'existing' : 'zero',
  )
  const [openingInput, setOpeningInput] = useState(
    openingBalance > 0 ? String(openingBalance) : '',
  )
  const [openingError, setOpeningError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  // On phones the nav is a list that opens one page at a time; on desktop the
  // nav stays beside the content and the first page is always visible.
  const activePage: SettingsPageId = page ?? 'appearance'
  const activeMeta =
    SETTINGS_PAGES.find((item) => item.id === activePage) ?? SETTINGS_PAGES[0]

  useEffect(() => {
    if (!open) return
    setPage(focusSection === 'opening-balance' ? 'opening' : null)
  }, [open, focusSection])

  useEffect(() => {
    if (open) {
      setBudgetInput(String(budget))
      setBudgetError('')
    }
  }, [open, budget])

  useEffect(() => {
    if (!open) return
    setOpeningMode(openingBalance > 0 ? 'existing' : 'zero')
    setOpeningInput(openingBalance > 0 ? String(openingBalance) : '')
    setOpeningError('')
  }, [open, openingBalance])

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

  const handleOpeningBalanceSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (openingMode === 'zero') {
      setOpeningError('')
      onOpeningBalanceSave(0)
      return
    }
    const value = Number(openingInput)
    if (
      !openingInput.trim() ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      setOpeningError('请输入大于等于 0 的起始资金')
      return
    }
    setOpeningError('')
    onOpeningBalanceSave(Math.round(value * 100) / 100)
  }

  const updateInDialog =
    updater.phase === 'checking' ||
    updater.phase === 'available' ||
    updater.phase === 'downloading' ||
    updater.phase === 'ready' ||
    updater.phase === 'installing' ||
    updater.phase === 'external' ||
    updater.phase === 'error'

  const mobileUpdate = updater.platform === 'mobile'
  let updateActionTitle = '检查更新'
  let updateActionDetail = mobileUpdate
    ? '从 GitHub Releases 检查手机版新版本'
    : '打开更新窗口，检查 GitHub 上的新版本'
  if (updater.phase === 'checking') {
    updateActionTitle = '正在检查更新'
    updateActionDetail = '打开更新窗口查看检查进度'
  } else if (updater.phase === 'available') {
    updateActionTitle = `查看新版本 v${updater.version ?? ''}`
    updateActionDetail = mobileUpdate
      ? '打开更新窗口，前往浏览器下载安装包'
      : '打开更新窗口，选择立刻更新或下次再说'
  } else if (updater.phase === 'external') {
    updateActionTitle = '更新包已交给浏览器'
    updateActionDetail = '打开更新窗口查看安装说明'
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
      <header className="modal-header settings-header">
        <div>
          <p className="eyebrow">偏好与数据</p>
          <h2 id="settings-modal-title">设置</h2>
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

      <div className={`settings-shell${page ? ' is-page-open' : ''}`}>
        <nav className="settings-nav" aria-label="设置分类">
          {SETTINGS_PAGES.map((item) => {
            const Icon = item.icon
            const active = activePage === item.id
            return (
              <button
                key={item.id}
                type="button"
                className={active ? 'is-active' : ''}
                onClick={() => setPage(item.id)}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={17} strokeWidth={1.8} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>

        <div className="settings-menu" role="list" aria-label="设置">
          {SETTINGS_PAGES.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                type="button"
                role="listitem"
                className="settings-menu-row"
                onClick={() => setPage(item.id)}
              >
                <span className="settings-menu-icon" aria-hidden="true">
                  <Icon size={18} strokeWidth={1.8} />
                </span>
                <span className="settings-menu-copy">
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <ChevronRight
                  size={16}
                  className="settings-menu-chevron"
                  aria-hidden="true"
                />
              </button>
            )
          })}
        </div>

        <div className={`settings-content${page ? ' is-open' : ''}`}>
          <header className="settings-content-head">
            <button
              type="button"
              className="settings-back"
              onClick={() => setPage(null)}
              aria-label="返回设置列表"
            >
              <ChevronLeft size={19} />
            </button>
            <div>
              <p className="eyebrow">设置</p>
              <h3>{activeMeta.label}</h3>
            </div>
          </header>

          <div className="settings-page" key={activePage}>
            {activePage === 'appearance' ? (
              <section className="settings-section">
                <div className="settings-heading">
                  <h3>外观</h3>
                  <p>
                    为当下的光线选一个舒适的阅读方式，再挑一套相配的主题。
                  </p>
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
                  <div
                    className="font-size-switch"
                    role="radiogroup"
                    aria-label="字体大小"
                  >
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
                            <span className="palette-option-name">
                              {item.name}
                            </span>
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
            ) : null}

            {activePage === 'currency' ? (
              <section className="settings-section">
                <div className="settings-heading">
                  <h3>货币</h3>
                  <p>
                    选择记账使用的货币。切换只更换金额符号，不会换算已有金额。
                  </p>
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
            ) : null}

            {activePage === 'categories' ? (
              <section className="settings-section">
                <div className="settings-heading">
                  <h3>分类</h3>
                  <p>
                    收入和支出各自管理。分类可以改名、换颜色和图标，自定义分类与内置分类地位相同。
                    小分类默认收起，点大分类左侧的箭头展开。
                  </p>
                </div>
                <CategorySettings
                  categories={categories}
                  transactionUsage={categoryTransactionUsage}
                  projectUsage={categoryProjectUsage}
                  onCreate={onCreateCategory}
                  onUpdate={onUpdateCategory}
                  onDelete={onDeleteCategory}
                />
              </section>
            ) : null}

            {activePage === 'opening' ? (
              <section
                className="settings-section"
                aria-labelledby="opening-balance-heading"
              >
                <div className="settings-heading">
                  <h3 id="opening-balance-heading">总结余起始资金</h3>
                  <p>
                    总结余 = 起始资金 + 区间收入 − 区间支出。使用账页之前已有的钱可以记在这里；
                    不填就当作从零开始，只统计账本里的收支。
                  </p>
                </div>
                <form
                  className="opening-balance-form"
                  onSubmit={handleOpeningBalanceSubmit}
                >
                  <div
                    className="opening-mode-switch"
                    role="group"
                    aria-label="起始资金方式"
                  >
                    <button
                      type="button"
                      className={openingMode === 'zero' ? 'is-active' : ''}
                      onClick={() => {
                        setOpeningMode('zero')
                        setOpeningError('')
                      }}
                      aria-pressed={openingMode === 'zero'}
                    >
                      从零开始
                    </button>
                    <button
                      type="button"
                      className={openingMode === 'existing' ? 'is-active' : ''}
                      onClick={() => {
                        setOpeningMode('existing')
                        setOpeningError('')
                      }}
                      aria-pressed={openingMode === 'existing'}
                    >
                      已有资金
                    </button>
                  </div>
                  {openingMode === 'existing' ? (
                    <label className="budget-input">
                      <span>{getCurrency(currency).symbol}</span>
                      <input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="0.01"
                        value={openingInput}
                        onChange={(event) => {
                          setOpeningInput(event.target.value)
                          setOpeningError('')
                        }}
                        placeholder="0.00"
                        aria-label="起始资金金额"
                      />
                    </label>
                  ) : (
                    <p className="opening-balance-note">
                      起始资金记为 0，总结余只反映选定区间内的收支。
                    </p>
                  )}
                  <button type="submit" className="button secondary">
                    保存起始资金
                  </button>
                </form>
                {openingError ? (
                  <p className="form-error" role="alert">
                    {openingError}
                  </p>
                ) : null}
              </section>
            ) : null}

            {activePage === 'budget' ? (
              <section className="settings-section">
                <div className="settings-heading">
                  <h3>月度预算</h3>
                  <p>
                    给日常生活留一条温柔的边界，当前预算{' '}
                    {formatMoney(budget)}。项目支出单独归集，不占生活预算。
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
            ) : null}

            {activePage === 'data' ? (
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
                      <small>
                        包含流水、分类、项目、预算与起始资金的 JSON 文件
                      </small>
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
                  <button
                    type="button"
                    className="data-row data-row--danger"
                    onClick={onClear}
                  >
                    <span className="data-row-icon">
                      <Trash2 size={18} />
                    </span>
                    <span className="data-row-text">
                      <strong>清除现有账本</strong>
                      <small>
                        删除全部流水、项目与负债，预算和起始资金重置
                      </small>
                    </span>
                  </button>
                </div>
                <p className="privacy-note">
                  <ShieldCheck size={15} />
                  账页没有账号系统，也不会把数据传到任何服务器。
                </p>
              </section>
            ) : null}

            {activePage === 'about' ? (
              <>
                <section className="settings-section">
                  <div className="settings-heading">
                    <h3>关于账页</h3>
                    <p>
                      {mobileUpdate
                        ? `当前版本 v${updater.currentVersion || '…'}。启动后会从 GitHub 自动检查新版本，发现更新时提示你下载安装包；下载与安装由系统浏览器完成。`
                        : updater.supported
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
                              updater.phase === 'checking'
                                ? 'is-spinning'
                                : undefined
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

                <section className="settings-section">
                  <div className="settings-heading">
                    <h3>在 GitHub 上关注账页</h3>
                    <p>
                      账页是一个本地优先的小项目，源码、版本发布记录和安装包都公开在 GitHub。遇到问题、想看看更新细节，或者想提交建议，都可以从下面进入。
                    </p>
                  </div>
                  <div className="data-actions">
                    <button
                      type="button"
                      className="data-row"
                      onClick={() => void openExternalUrl(GITHUB_REPO_URL)}
                    >
                      <span className="data-row-icon">
                        <Github size={18} />
                      </span>
                      <span className="data-row-text">
                        <strong>账页的 GitHub 仓库</strong>
                        <small>github.com/1279255198psy/ledger</small>
                      </span>
                      <ExternalLink size={15} className="data-row-external" />
                    </button>
                    <button
                      type="button"
                      className="data-row"
                      onClick={() => void openExternalUrl(GITHUB_RELEASES_URL)}
                    >
                      <span className="data-row-icon">
                        <Tag size={18} />
                      </span>
                      <span className="data-row-text">
                        <strong>版本发布记录</strong>
                        <small>查看历史版本与安装包</small>
                      </span>
                      <ExternalLink size={15} className="data-row-external" />
                    </button>
                  </div>
                </section>
              </>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  )
}
