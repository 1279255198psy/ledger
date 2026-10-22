import { useEffect, useState } from 'react'
import { Check, X } from 'lucide-react'
import { Sidebar } from './components/Sidebar'
import {
  confirmDesktopAction,
  isDesktopApp,
  saveTextFile,
} from './lib/desktop'
import { TopBar } from './components/TopBar'
import { MobileNav } from './components/MobileNav'
import { TransactionModal } from './components/TransactionModal'
import { SettingsModal } from './components/SettingsModal'
import { UpdateDialog } from './components/UpdateDialog'
import { useUpdater } from './hooks/useUpdater'
import { Overview } from './pages/Overview'
import { Transactions } from './pages/Transactions'
import { Projects } from './pages/Projects'
import { Analytics } from './pages/Analytics'
import {
  createSeedTransactions,
  newProjectId,
  newTransactionId,
  sortTransactions,
} from './lib/data'
import {
  getMonthSpendCents,
  makeDailyAllocation,
  scaleAllocations,
  sumAllocationCents,
} from './lib/allocations'
import {
  DEFAULT_BUDGET,
  ImportError,
  loadBudget,
  loadCurrency,
  loadFontSize,
  loadPalette,
  loadProjects,
  loadTheme,
  loadTransactions,
  parseBackup,
  saveBudget,
  saveCurrency,
  saveFontSize,
  savePalette,
  saveProjects,
  saveTheme,
  saveTransactions,
} from './lib/storage'
import { getCurrency, setActiveCurrency } from './lib/currency'
import { paletteThemeColor } from './lib/themes'
import {
  currentMonthKey,
  defaultDateForMonth,
  formatMoney,
  localDateKey,
  monthLabel,
  monthOfDateKey,
  shiftMonth,
  transactionsToCsv,
} from './lib/utils'
import type {
  AllocationLine,
  Currency,
  FontSize,
  LedgerTransaction,
  Palette,
  Project,
  ProjectDraft,
  Theme,
  TransactionDraft,
  View,
} from './types'

interface ToastState {
  id: number
  message: string
  kind: 'success' | 'error'
}

function resolveDraftAllocations(
  draft: TransactionDraft,
  editing: LedgerTransaction | null,
): AllocationLine[] {
  if (draft.allocations && draft.allocations.length > 0) {
    return sumAllocationCents(draft.allocations) === draft.amountCents
      ? draft.allocations
      : scaleAllocations(draft.allocations, draft.amountCents)
  }
  if (editing) {
    return scaleAllocations(editing.allocations, draft.amountCents)
  }
  return [makeDailyAllocation(draft.amountCents)]
}

export default function App() {
  const [view, setView] = useState<View>('overview')
  const [monthKey, setMonthKey] = useState(() => currentMonthKey())
  const [transactions, setTransactions] =
    useState<LedgerTransaction[]>(loadTransactions)
  const [projects, setProjects] = useState<Project[]>(loadProjects)
  const [budget, setBudget] = useState(loadBudget)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [palette, setPalette] = useState<Palette>(loadPalette)
  const [fontSize, setFontSize] = useState<FontSize>(loadFontSize)
  const [currency, setCurrency] = useState<Currency>(() => {
    const stored = loadCurrency()
    setActiveCurrency(stored)
    return stored
  })
  const [transactionModalOpen, setTransactionModalOpen] = useState(false)
  const [editing, setEditing] = useState<LedgerTransaction | null>(null)
  const [transactionProjectId, setTransactionProjectId] = useState<
    string | null
  >(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [toast, setToast] = useState<ToastState | null>(null)
  const updater = useUpdater()

  const latestMonth = currentMonthKey()
  const monthSpend = getMonthSpendCents(transactions, monthKey)

  useEffect(() => {
    saveTransactions(transactions)
  }, [transactions])

  useEffect(() => {
    saveProjects(projects)
  }, [projects])

  useEffect(() => {
    saveBudget(budget)
  }, [budget])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.style.colorScheme = theme
    saveTheme(theme)
  }, [theme])

  useEffect(() => {
    document.documentElement.dataset.fontSize = fontSize
    saveFontSize(fontSize)
  }, [fontSize])

  useEffect(() => {
    saveCurrency(currency)
  }, [currency])

  useEffect(() => {
    document.documentElement.dataset.palette = palette
    savePalette(palette)
    const meta = document.querySelector<HTMLMetaElement>(
      'meta[name="theme-color"]',
    )
    if (meta) meta.content = paletteThemeColor(palette, theme)
  }, [palette, theme])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 3200)
    return () => window.clearTimeout(timer)
  }, [toast])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable
      if (
        event.key.toLowerCase() === 'n' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !isTyping &&
        !transactionModalOpen &&
        !settingsOpen &&
        !updater.dialogOpen
      ) {
        event.preventDefault()
        setEditing(null)
        setTransactionModalOpen(true)
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [transactionModalOpen, settingsOpen, updater.dialogOpen])

  const showToast = (message: string, kind: 'success' | 'error' = 'success') => {
    setToast({ id: Date.now(), message, kind })
  }

  const openAdd = () => {
    setEditing(null)
    setTransactionProjectId(null)
    setTransactionModalOpen(true)
  }

  const openAddForProject = (projectId: string) => {
    setEditing(null)
    setTransactionProjectId(projectId)
    setTransactionModalOpen(true)
  }

  const openEdit = (transaction: LedgerTransaction) => {
    setEditing(transaction)
    setTransactionProjectId(null)
    setTransactionModalOpen(true)
  }

  const closeTransactionModal = () => {
    setTransactionModalOpen(false)
    setEditing(null)
    setTransactionProjectId(null)
  }

  const handleSaveTransaction = (draft: TransactionDraft) => {
    const targetMonth = monthOfDateKey(draft.date)
    const allocations = resolveDraftAllocations(draft, editing)
    const base = {
      schemaVersion: 2 as const,
      type: draft.type,
      amountCents: draft.amountCents,
      categoryId: draft.categoryId,
      accountId: draft.accountId,
      date: draft.date,
      note: draft.note,
      allocations,
    }

    if (editing) {
      const updatedAt = new Date().toISOString()
      setTransactions((current) =>
        sortTransactions(
          current.map((item) =>
            item.id === editing.id
              ? { ...item, ...base, updatedAt }
              : item,
          ),
        ),
      )
      showToast('这笔记录已更新')
    } else {
      const created: LedgerTransaction = {
        ...base,
        id: newTransactionId(),
        createdAt: new Date().toISOString(),
      }
      setTransactions((current) => sortTransactions([created, ...current]))
      showToast(
        draft.type === 'expense'
          ? `已记下支出 ${formatMoney(draft.amountCents / 100)}`
          : `已记下收入 ${formatMoney(draft.amountCents / 100)}`,
      )
    }
    if (targetMonth !== monthKey && targetMonth <= latestMonth) {
      setMonthKey(targetMonth)
    }
    closeTransactionModal()
  }

  const handleDeleteTransaction = async (id: string) => {
    const confirmed = await confirmDesktopAction(
      '确定删除这笔流水吗？删除后无法恢复。',
      '删除流水',
    )
    if (!confirmed) return
    setTransactions((current) => current.filter((item) => item.id !== id))
    closeTransactionModal()
    showToast('这笔记录已删除')
  }

  const handleChangeView = (nextView: View) => {
    setView(nextView)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleMonthShift = (delta: number) => {
    setMonthKey((current) => {
      const next = shiftMonth(current, delta)
      return next > latestMonth ? current : next
    })
  }

  const handleBudgetSave = (nextBudget: number) => {
    setBudget(nextBudget)
    showToast('月度预算已更新')
  }

  const handleCreateProject = (draft: ProjectDraft): string => {
    const now = new Date().toISOString()
    const project: Project = {
      id: newProjectId(),
      name: draft.name.trim(),
      status: 'active',
      startDate: draft.startDate,
      ...(draft.endDate ? { endDate: draft.endDate } : {}),
      ...(draft.budgetCents !== undefined
        ? { budgetCents: draft.budgetCents }
        : {}),
      ...(draft.categoryBudgetsCents &&
      Object.keys(draft.categoryBudgetsCents).length > 0
        ? { categoryBudgetsCents: draft.categoryBudgetsCents }
        : {}),
      ...(draft.note ? { note: draft.note } : {}),
      currency,
      createdAt: now,
      updatedAt: now,
    }
    setProjects((current) => [project, ...current])
    showToast(`项目「${project.name}」已创建`)
    return project.id
  }

  const handleUpdateProject = (id: string, draft: ProjectDraft) => {
    const now = new Date().toISOString()
    setProjects((current) =>
      current.map((project) =>
        project.id === id
          ? {
              ...project,
              name: draft.name.trim(),
              startDate: draft.startDate,
              endDate: draft.endDate,
              budgetCents: draft.budgetCents,
              categoryBudgetsCents: draft.categoryBudgetsCents,
              note: draft.note,
              updatedAt: now,
            }
          : project,
      ),
    )
    showToast(`项目「${draft.name.trim()}」已更新`)
  }

  const handleToggleProjectStatus = (id: string) => {
    const project = projects.find((item) => item.id === id)
    if (!project) return
    const active = project.status === 'active'
    const now = new Date().toISOString()
    const today = localDateKey()
    setProjects((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status: active ? 'closed' : 'active',
              endDate: active ? today : undefined,
              updatedAt: now,
            }
          : item,
      ),
    )
    showToast(
      active
        ? `项目「${project.name}」已结束`
        : `项目「${project.name}」已重新启用`,
    )
  }

  const handleToggleProjectArchive = (id: string) => {
    const project = projects.find((item) => item.id === id)
    if (!project) return
    const archived = Boolean(project.archivedAt)
    const now = new Date().toISOString()
    setProjects((current) =>
      current.map((item) => {
        if (item.id !== id) return item
        if (archived) {
          return { ...item, archivedAt: undefined, updatedAt: now }
        }
        return {
          ...item,
          archivedAt: now,
          updatedAt: now,
        }
      }),
    )
    showToast(
      archived
        ? `项目「${project.name}」已恢复`
        : `项目「${project.name}」已归档`,
    )
  }

  const handleCurrencyChange = (nextCurrency: Currency) => {
    setActiveCurrency(nextCurrency)
    setCurrency(nextCurrency)
    showToast(`货币已切换为${getCurrency(nextCurrency).name}`)
  }

  const handleExportJson = async () => {
    const payload = {
      app: '账页',
      version: 2,
      exportedAt: new Date().toISOString(),
      budget,
      budgetCents: Math.round(budget * 100),
      projects,
      transactions,
    }
    try {
      const saved = await saveTextFile({
        fileName: `zhangye-backup-${localDateKey()}.json`,
        contents: JSON.stringify(payload, null, 2),
        mimeType: 'application/json;charset=utf-8',
        filterName: 'JSON 备份',
        extensions: ['json'],
      })
      if (saved) showToast('完整备份已导出')
    } catch {
      showToast('导出失败，请稍后重试', 'error')
    }
  }

  const handleExportCsv = async () => {
    const csv = `﻿${transactionsToCsv(
      [...transactions].sort((a, b) => b.date.localeCompare(a.date)),
    )}`
    try {
      const saved = await saveTextFile({
        fileName: `zhangye-transactions-${localDateKey()}.csv`,
        contents: csv,
        mimeType: 'text/csv;charset=utf-8',
        filterName: 'CSV 表格',
        extensions: ['csv'],
      })
      if (saved) showToast('流水表格已导出')
    } catch {
      showToast('导出失败，请稍后重试', 'error')
    }
  }

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text()
      const imported = parseBackup(text)
      setTransactions(sortTransactions(imported.transactions))
      setProjects(imported.projects)
      if (imported.budget !== null) setBudget(imported.budget)
      setSettingsOpen(false)
      setMonthKey(currentMonthKey())
      setView('overview')
      showToast(`已导入 ${imported.transactions.length} 笔流水`)
    } catch (error) {
      showToast(
        error instanceof ImportError ? error.message : '导入失败，请检查备份文件',
        'error',
      )
    }
  }

  const handleLoadSample = () => {
    setTransactions(createSeedTransactions())
    setProjects([])
    setMonthKey(currentMonthKey())
    setView('overview')
    showToast('示例账本已载入')
  }

  const handleReset = async () => {
    const confirmed = await confirmDesktopAction(
      '确定恢复示例账本吗？当前的全部流水和预算设置会被覆盖，此操作无法撤销。',
      '恢复示例账本',
    )
    if (!confirmed) return
    const seed = createSeedTransactions()
    setTransactions(seed)
    setProjects([])
    setBudget(DEFAULT_BUDGET)
    setMonthKey(currentMonthKey())
    setSettingsOpen(false)
    setView('overview')
    showToast('示例账本已恢复')
  }

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        monthLabelText={monthLabel(monthKey)}
        expense={monthSpend.dailyCents / 100}
        budget={budget}
        theme={theme}
        onChangeView={handleChangeView}
        onAdd={openAdd}
        onToggleTheme={() =>
          setTheme((current) => (current === 'light' ? 'dark' : 'light'))
        }
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <main className="main-content">
        <TopBar
          view={view}
          monthKey={monthKey}
          onMonthShift={handleMonthShift}
          onThisMonth={() => setMonthKey(currentMonthKey())}
          onAdd={openAdd}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {view === 'overview' ? (
          <Overview
            transactions={transactions}
            projects={projects}
            monthKey={monthKey}
            budget={budget}
            onAdd={openAdd}
            onEdit={openEdit}
            onDelete={handleDeleteTransaction}
            onChangeView={handleChangeView}
            onOpenBudget={() => setSettingsOpen(true)}
            onLoadSample={handleLoadSample}
          />
        ) : null}

        {view === 'transactions' ? (
          <Transactions
            transactions={transactions}
            projects={projects}
            monthKey={monthKey}
            onAdd={openAdd}
            onEdit={openEdit}
            onDelete={handleDeleteTransaction}
            onLoadSample={handleLoadSample}
          />
        ) : null}

        {view === 'projects' ? (
          <Projects
            transactions={transactions}
            projects={projects}
            onCreateProject={handleCreateProject}
            onUpdateProject={handleUpdateProject}
            onToggleProjectStatus={handleToggleProjectStatus}
            onToggleProjectArchive={handleToggleProjectArchive}
            onAddTransaction={openAddForProject}
            onEditTransaction={openEdit}
            onDeleteTransaction={handleDeleteTransaction}
          />
        ) : null}

        {view === 'analytics' ? (
          <Analytics
            transactions={transactions}
            projects={projects}
            monthKey={monthKey}
            budget={budget}
            onAdd={openAdd}
            onChangeView={handleChangeView}
            onLoadSample={handleLoadSample}
          />
        ) : null}

        <footer className="app-footer">
          <span>账页 · 写给自己看的生活账本</span>
          <span>
            {isDesktopApp()
              ? '数据保存在本机应用数据目录'
              : '数据保存在这台设备的浏览器中'}
          </span>
        </footer>
      </main>

      <MobileNav view={view} onChangeView={handleChangeView} />

      <button
        type="button"
        className="mobile-fab"
        onClick={openAdd}
        aria-label="记一笔"
      >
        <span>＋</span>
      </button>

      <TransactionModal
        open={transactionModalOpen}
        editing={editing}
        projects={projects}
        defaultDate={defaultDateForMonth(monthKey)}
        defaultProjectId={transactionProjectId ?? undefined}
        onClose={closeTransactionModal}
        onSave={handleSaveTransaction}
        onDelete={handleDeleteTransaction}
      />

      <SettingsModal
        open={settingsOpen}
        budget={budget}
        theme={theme}
        palette={palette}
        fontSize={fontSize}
        currency={currency}
        updater={updater}
        onClose={() => setSettingsOpen(false)}
        onBudgetSave={handleBudgetSave}
        onThemeChange={setTheme}
        onPaletteChange={setPalette}
        onFontSizeChange={setFontSize}
        onCurrencyChange={handleCurrencyChange}
        onExportJson={handleExportJson}
        onExportCsv={handleExportCsv}
        onImportFile={handleImportFile}
        onReset={handleReset}
      />

      <UpdateDialog
        updater={updater}
        suspended={transactionModalOpen || settingsOpen}
      />

      {toast ? (
        <div
          key={toast.id}
          className={`toast toast--${toast.kind}`}
          role={toast.kind === 'error' ? 'alert' : 'status'}
          aria-live="polite"
        >
          {toast.kind === 'success' ? <Check size={16} /> : <X size={16} />}
          <span>{toast.message}</span>
        </div>
      ) : null}
    </div>
  )
}
