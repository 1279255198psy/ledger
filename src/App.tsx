import { useEffect, useMemo, useState } from 'react'
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
import { useReminderScheduler } from './hooks/useReminderScheduler'
import { Overview } from './pages/Overview'
import { Transactions } from './pages/Transactions'
import { Projects } from './pages/Projects'
import { Analytics } from './pages/Analytics'
import { Liabilities } from './pages/Liabilities'
import { Indices } from './pages/Indices'
import { newProjectId, newTransactionId, sortTransactions } from './lib/data'
import { createSampleLedger } from './lib/sample'
import {
  mergeAccounts,
  newAccountId,
  setActiveAccounts,
  uniqueAccountName,
} from './lib/accounts'
import {
  detachProjectAllocations,
  getCountedProjectIds,
  makeDailyAllocation,
  scaleAllocations,
  sumAllocationCents,
} from './lib/allocations'
import {
  ImportError,
  loadAccounts,
  loadBudgetRanges,
  loadBudgets,
  loadCategories,
  loadCurrency,
  loadFontSize,
  loadLiabilities,
  loadOpeningBalance,
  loadPalette,
  loadProjects,
  loadReminders,
  loadTheme,
  loadTransactions,
  parseBackup,
  saveAccounts,
  saveBudgetRanges,
  saveBudgets,
  saveCategories,
  saveCurrency,
  saveFontSize,
  saveLiabilities,
  saveOpeningBalance,
  savePalette,
  saveProjects,
  saveReminders,
  saveTheme,
  saveTransactions,
} from './lib/storage'
import {
  getMonthBudgetMetrics,
  getRangeBudgetMetrics,
  rangeOverlapsMonth,
} from './lib/budget'
import {
  DEFAULT_CATEGORIES,
  newCategoryId,
  setActiveCategories,
} from './lib/categories'
import {
  newRepaymentId,
  newLiabilityId,
  sortLiabilities,
} from './lib/liabilities'
import type { CategoryDraft } from './lib/categories'
import { getCurrency, setActiveCurrency } from './lib/currency'
import {
  getSyncState,
  initSync,
  setSyncSuspended,
} from './lib/sync/engine'
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
  Account,
  AllocationLine,
  BudgetBook,
  Category,
  Currency,
  FontSize,
  LedgerTransaction,
  Liability,
  LiabilityDraft,
  MonthBudget,
  Palette,
  Project,
  ProjectDraft,
  RangeBudget,
  ReminderSettings,
  RepaymentDraft,
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
  // Categories initialize first: transaction loading validates ids against them.
  const [categories, setCategories] = useState<Category[]>(loadCategories)
  const [accounts, setAccounts] = useState<Account[]>(loadAccounts)
  const [transactions, setTransactions] =
    useState<LedgerTransaction[]>(loadTransactions)
  const [projects, setProjects] = useState<Project[]>(loadProjects)
  const [liabilities, setLiabilities] = useState<Liability[]>(loadLiabilities)
  const [budgets, setBudgets] = useState<BudgetBook>(loadBudgets)
  const [budgetRanges, setBudgetRanges] =
    useState<RangeBudget[]>(loadBudgetRanges)
  const [openingBalance, setOpeningBalance] = useState(loadOpeningBalance)
  const [theme, setTheme] = useState<Theme>(loadTheme)
  const [palette, setPalette] = useState<Palette>(loadPalette)
  const [fontSize, setFontSize] = useState<FontSize>(loadFontSize)
  const [currency, setCurrency] = useState<Currency>(() => {
    const stored = loadCurrency()
    setActiveCurrency(stored)
    return stored
  })
  const [reminders, setReminders] = useState<ReminderSettings>(loadReminders)
  const [transactionModalOpen, setTransactionModalOpen] = useState(false)
  const [editing, setEditing] = useState<LedgerTransaction | null>(null)
  const [transactionProjectId, setTransactionProjectId] = useState<
    string | null
  >(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsFocus, setSettingsFocus] = useState<
    'opening-balance' | 'budget' | 'budget-ranges' | null
  >(null)
  const [toast, setToast] = useState<ToastState | null>(null)
  const updater = useUpdater()

  const latestMonth = currentMonthKey()
  // Projects set to 计入日常 share one daily bucket with everyday spending;
  // the rest stay on their own books.
  const countedProjectIds = useMemo(
    () => getCountedProjectIds(projects),
    [projects],
  )
  const budgetMetrics = useMemo(
    () =>
      getMonthBudgetMetrics(
        transactions,
        monthKey,
        budgets,
        countedProjectIds,
      ),
    [transactions, monthKey, budgets, countedProjectIds],
  )
  // Each range is scored on its own dates; crossing a month boundary never
  // splits the amount or reconciles it against that month's budget.
  const budgetRangeMetrics = useMemo(
    () =>
      budgetRanges.map((range) =>
        getRangeBudgetMetrics(transactions, range, undefined, countedProjectIds),
      ),
    [budgetRanges, transactions, countedProjectIds],
  )
  // The month views only surface ranges that actually touch the shown month.
  const monthRangeMetrics = useMemo(
    () =>
      budgetRangeMetrics.filter((entry) =>
        rangeOverlapsMonth(entry.range, monthKey),
      ),
    [budgetRangeMetrics, monthKey],
  )

  const categoryTransactionUsage = useMemo(() => {
    const usage: Record<string, number> = {}
    for (const item of transactions) {
      usage[item.categoryId] = (usage[item.categoryId] ?? 0) + 1
    }
    return usage
  }, [transactions])

  const accountTransactionUsage = useMemo(() => {
    const usage: Record<string, number> = {}
    for (const item of transactions) {
      usage[item.accountId] = (usage[item.accountId] ?? 0) + 1
    }
    return usage
  }, [transactions])

  const categoryProjectUsage = useMemo(() => {
    const usage: Record<string, number> = {}
    for (const project of projects) {
      for (const categoryId of Object.keys(
        project.categoryBudgetsCents ?? {},
      )) {
        usage[categoryId] = (usage[categoryId] ?? 0) + 1
      }
    }
    return usage
  }, [projects])

  useEffect(() => {
    saveCategories(categories)
  }, [categories])

  useEffect(() => {
    saveAccounts(accounts)
  }, [accounts])

  useEffect(() => {
    saveTransactions(transactions)
  }, [transactions])

  useEffect(() => {
    saveProjects(projects)
  }, [projects])

  useEffect(() => {
    saveLiabilities(sortLiabilities(liabilities))
  }, [liabilities])

  useEffect(() => {
    saveBudgets(budgets)
  }, [budgets])

  useEffect(() => {
    saveBudgetRanges(budgetRanges)
  }, [budgetRanges])

  useEffect(() => {
    saveOpeningBalance(openingBalance)
  }, [openingBalance])

  useEffect(() => {
    void initSync()
  }, [])

  // Keep background syncs from closing an entry form the user is filling in.
  useEffect(() => {
    setSyncSuspended(transactionModalOpen || editing !== null)
  }, [transactionModalOpen, editing])

  // Applying a snapshot from the other device rewrites storage outside React,
  // so reload every books-related state from disk.
  useEffect(() => {
    const reload = () => {
      const nextCategories = loadCategories()
      setActiveCategories(nextCategories)
      setCategories(nextCategories)
      setAccounts(loadAccounts())
      setTransactions(loadTransactions())
      setProjects(loadProjects())
      setLiabilities(loadLiabilities())
      setBudgets(loadBudgets())
      setBudgetRanges(loadBudgetRanges())
      setOpeningBalance(loadOpeningBalance())
      setEditing(null)
      setTransactionModalOpen(false)
      setTransactionProjectId(null)
    }
    window.addEventListener('zhangye:ledger-reloaded', reload)
    return () => window.removeEventListener('zhangye:ledger-reloaded', reload)
  }, [])

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
    saveReminders(reminders)
  }, [reminders])

  useReminderScheduler(reminders)

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

  // Category lookups read module state, so update it before React re-renders.
  const commitCategories = (next: Category[]) => {
    setActiveCategories(next)
    setCategories(next)
  }

  // Rows and the CSV export look up account names through module state, so
  // update it in the same tick as the React list.
  const commitAccounts = (next: Account[]) => {
    setActiveAccounts(next)
    setAccounts(next)
  }

  const handleCreateCategory = (draft: CategoryDraft): Category => {
    const category: Category = {
      id: newCategoryId(),
      type: draft.type,
      name: draft.name.trim(),
      color: draft.color,
      icon: draft.icon,
      ...(draft.parentId ? { parentId: draft.parentId } : {}),
    }
    commitCategories([...categories, category])
    showToast(
      draft.parentId
        ? `小分类「${category.name}」已创建`
        : `分类「${category.name}」已创建`,
    )
    return category
  }

  const handleUpdateCategory = (id: string, draft: CategoryDraft) => {
    const next = categories.map((category) => {
      if (category.id !== id) return category
      const updated: Category = {
        ...category,
        type: draft.type,
        name: draft.name.trim(),
        color: draft.color,
        icon: draft.icon,
      }
      if (draft.parentId) updated.parentId = draft.parentId
      else delete updated.parentId
      return updated
    })
    commitCategories(next)
    const name = draft.name.trim()
    showToast(`分类「${name}」已更新`)
  }

  const handleDeleteCategory = async (id: string) => {
    const category = categories.find((item) => item.id === id)
    if (!category) return
    if (categories.some((item) => item.parentId === id)) return
    const confirmed = await confirmDesktopAction(
      `确定删除分类「${category.name}」吗？`,
      '删除分类',
    )
    if (!confirmed) return
    commitCategories(categories.filter((item) => item.id !== id))
    showToast(`分类「${category.name}」已删除`)
  }

  const handleCreateAccount = (bank: string, name: string) => {
    const trimmedBank = bank.trim()
    const desired = name.trim() || trimmedBank
    const finalName = uniqueAccountName(desired, accounts)
    const account: Account = {
      id: newAccountId(),
      name: finalName || '银行卡',
      type: 'bank',
      bank: trimmedBank,
    }
    commitAccounts([...accounts, account])
    showToast(
      finalName === desired
        ? `银行卡「${account.name}」已添加`
        : `同名银行卡已自动编号为「${account.name}」`,
    )
  }

  const handleRenameAccount = (id: string, name: string) => {
    const account = accounts.find((item) => item.id === id)
    if (!account || account.type !== 'bank') return
    const trimmed = name.trim()
    if (!trimmed) return
    const finalName = uniqueAccountName(trimmed, accounts, id)
    commitAccounts(
      accounts.map((item) =>
        item.id === id ? { ...item, name: finalName } : item,
      ),
    )
    showToast(
      finalName === trimmed
        ? `银行卡已改名为「${finalName}」`
        : `已有同名银行卡，已自动命名为「${finalName}」`,
    )
  }

  const handleDeleteAccount = async (id: string) => {
    const account = accounts.find((item) => item.id === id)
    if (!account || account.type !== 'bank') return
    const used = accountTransactionUsage[id] ?? 0
    if (used > 0) {
      showToast('这张卡还有流水记录，暂时不能删除', 'error')
      return
    }
    const confirmed = await confirmDesktopAction(
      `确定删除银行卡「${account.name}」吗？此操作无法撤销。`,
      '删除银行卡',
    )
    if (!confirmed) return
    commitAccounts(accounts.filter((item) => item.id !== id))
    showToast(`银行卡「${account.name}」已删除`)
  }

  const handleCreateLiability = (draft: LiabilityDraft) => {
    const now = new Date().toISOString()
    const liability: Liability = {
      id: newLiabilityId(),
      name: draft.name.trim(),
      principalCents: draft.principalCents,
      ...(draft.dueDate ? { dueDate: draft.dueDate } : {}),
      ...(draft.note ? { note: draft.note } : {}),
      repayments: [],
      createdAt: now,
      updatedAt: now,
    }
    setLiabilities((current) => sortLiabilities([liability, ...current]))
    showToast(`负债「${liability.name}」已记录`)
  }

  const handleUpdateLiability = (id: string, draft: LiabilityDraft) => {
    const now = new Date().toISOString()
    setLiabilities((current) =>
      sortLiabilities(
        current.map((liability) =>
          liability.id === id
            ? {
                ...liability,
                name: draft.name.trim(),
                principalCents: draft.principalCents,
                dueDate: draft.dueDate,
                note: draft.note,
                updatedAt: now,
              }
            : liability,
        ),
      ),
    )
    showToast(`负债「${draft.name.trim()}」已更新`)
  }

  const handleDeleteLiability = async (id: string) => {
    const liability = liabilities.find((item) => item.id === id)
    if (!liability) return
    const confirmed = await confirmDesktopAction(
      `确定删除负债「${liability.name}」吗？还款记录也会一并删除，此操作无法撤销。`,
      '删除负债',
    )
    if (!confirmed) return
    setLiabilities((current) =>
      current.filter((item) => item.id !== id),
    )
    showToast(`负债「${liability.name}」已删除`)
  }

  const handleAddRepayment = (liabilityId: string, draft: RepaymentDraft) => {
    const now = new Date().toISOString()
    setLiabilities((current) =>
      sortLiabilities(
        current.map((liability) =>
          liability.id === liabilityId
            ? {
                ...liability,
                repayments: [
                  ...liability.repayments,
                  {
                    id: newRepaymentId(),
                    amountCents: draft.amountCents,
                    date: draft.date,
                    ...(draft.note ? { note: draft.note } : {}),
                    createdAt: now,
                  },
                ],
                updatedAt: now,
              }
            : liability,
        ),
      ),
    )
    showToast(`已记下还款 ${formatMoney(draft.amountCents / 100)}`)
  }

  const handleDeleteRepayment = async (
    liabilityId: string,
    repaymentId: string,
  ) => {
    const confirmed = await confirmDesktopAction(
      '确定删除这笔还款记录吗？此操作无法撤销。',
      '删除还款',
    )
    if (!confirmed) return
    const now = new Date().toISOString()
    setLiabilities((current) =>
      current.map((liability) =>
        liability.id === liabilityId
          ? {
              ...liability,
              repayments: liability.repayments.filter(
                (repayment) => repayment.id !== repaymentId,
              ),
              updatedAt: now,
            }
          : liability,
      ),
    )
    showToast('还款记录已删除')
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
      spendingNature:
        draft.type === 'expense' ? draft.spendingNature : undefined,
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

  const handleBudgetSave = (nextBudget: MonthBudget) => {
    setBudgets((current) => ({ ...current, [nextBudget.month]: nextBudget }))
    showToast(`${monthLabel(nextBudget.month)}预算已更新`)
  }

  const handleRangeSave = (nextRange: RangeBudget) => {
    setBudgetRanges((current) => {
      const exists = current.some((item) => item.id === nextRange.id)
      const next = exists
        ? current.map((item) =>
            item.id === nextRange.id ? nextRange : item,
          )
        : [...current, nextRange]
      return next.sort(
        (left, right) =>
          left.startDate.localeCompare(right.startDate) ||
          left.endDate.localeCompare(right.endDate),
      )
    })
    showToast(
      nextRange.name
        ? `区间预算「${nextRange.name}」已更新`
        : '区间预算已更新',
    )
  }

  const handleRangeDelete = async (id: string): Promise<boolean> => {
    const range = budgetRanges.find((item) => item.id === id)
    if (!range) return false
    const confirmed = await confirmDesktopAction(
      `确定删除区间预算「${range.name || `${range.startDate} 至 ${range.endDate}`}」吗？此操作无法撤销。`,
      '删除区间预算',
    )
    if (!confirmed) return false
    setBudgetRanges((current) => current.filter((item) => item.id !== id))
    showToast('区间预算已删除')
    return true
  }

  const handleOpeningBalanceSave = (nextBalance: number) => {
    setOpeningBalance(nextBalance)
    showToast(
      nextBalance > 0
        ? `起始资金已设为 ${formatMoney(nextBalance)}`
        : '总结余已改为从零开始',
    )
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
      ...(draft.countsInDaily ? { countsInDaily: true } : {}),
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
              countsInDaily: draft.countsInDaily || undefined,
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

  const handleDeleteProject = async (id: string) => {
    const project = projects.find((item) => item.id === id)
    if (!project) return
    const linkedCount = transactions.filter((transaction) =>
      transaction.allocations.some(
        (line) =>
          line.targetType === 'project' && line.projectId === id,
      ),
    ).length
    const confirmed = await confirmDesktopAction(
      linkedCount > 0
        ? `确定删除项目「${project.name}」吗？归入该项目的 ${linkedCount} 笔流水会转回日常支出，此操作无法撤销。`
        : `确定删除项目「${project.name}」吗？此操作无法撤销。`,
      '删除项目',
    )
    if (!confirmed) return

    const now = new Date().toISOString()
    setTransactions((current) =>
      current.map((transaction) => {
        const allocations = detachProjectAllocations(
          transaction.allocations,
          id,
        )
        return allocations === transaction.allocations
          ? transaction
          : { ...transaction, allocations, updatedAt: now }
      }),
    )
    setProjects((current) => current.filter((item) => item.id !== id))
    showToast(`项目「${project.name}」已删除`)
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
      budget: budgetMetrics.amountCents / 100,
      budgetCents: budgetMetrics.amountCents,
      budgets,
      budgetRanges,
      openingBalance,
      openingBalanceCents: Math.round(openingBalance * 100),
      categories,
      accounts,
      projects,
      liabilities,
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
      if (getSyncState().enabled) {
        const confirmed = await confirmDesktopAction(
          '导入会替换这台设备的账本，并同步到另一台设备。确定继续吗？',
          '导入备份',
        )
        if (!confirmed) return
      }
      const text = await file.text()
      const imported = parseBackup(text)
      if (imported.categories) commitCategories(imported.categories)
      if (imported.accounts) commitAccounts(imported.accounts)
      setTransactions(sortTransactions(imported.transactions))
      setProjects(imported.projects)
      if (imported.liabilities !== null) {
        setLiabilities(imported.liabilities)
      }
      if (imported.budgets !== null) setBudgets(imported.budgets)
      if (imported.budgetRanges !== null) {
        setBudgetRanges(imported.budgetRanges)
      }
      if (imported.openingBalance !== null) {
        setOpeningBalance(imported.openingBalance)
      }
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

  const applySampleLedger = () => {
    const sample = createSampleLedger()
    commitCategories(DEFAULT_CATEGORIES)
    // Keep cards the user already named; only add the demo cards that are
    // needed for the sample transactions.
    commitAccounts(mergeAccounts(accounts, sample.accounts))
    setTransactions(sample.transactions)
    setProjects(sample.projects)
    setLiabilities(sample.liabilities)
    setBudgets(sample.budgets)
    setBudgetRanges(sample.budgetRanges)
    setOpeningBalance(sample.openingBalanceCents / 100)
    setMonthKey(currentMonthKey())
    setView('overview')
  }

  const handleLoadSample = () => {
    applySampleLedger()
    showToast('示例账本已载入')
  }

  const handleReset = async () => {
    const syncHint = getSyncState().enabled
      ? '同步已开启，这次改动也会同步到另一台设备。'
      : ''
    const confirmed = await confirmDesktopAction(
      `确定恢复示例账本吗？当前的全部流水和预算设置会被覆盖，此操作无法撤销。${syncHint}`,
      '恢复示例账本',
    )
    if (!confirmed) return
    applySampleLedger()
    setSettingsOpen(false)
    showToast('示例账本已恢复')
  }

  const handleClearLedger = async () => {
    const syncHint = getSyncState().enabled
      ? '同步已开启，另一台设备上的账目也会被清除。'
      : ''
    const confirmed = await confirmDesktopAction(
      `确定清除现有账本吗？全部流水、项目与负债会被删除，预算和起始资金会重置。分类与外观设置保留。此操作无法撤销，建议先导出备份。${syncHint}`,
      '清除现有账本',
    )
    if (!confirmed) return
    setTransactions([])
    setProjects([])
    setLiabilities([])
    setBudgets({})
    setBudgetRanges([])
    setOpeningBalance(0)
    setMonthKey(currentMonthKey())
    setSettingsOpen(false)
    setView('overview')
    showToast('账本已清除')
  }

  return (
    <div className="app-shell">
      <Sidebar
        view={view}
        monthLabelText={monthLabel(monthKey)}
        budgetMetrics={budgetMetrics}
        rangeMetrics={budgetRangeMetrics}
        theme={theme}
        onChangeView={handleChangeView}
        onAdd={openAdd}
        onToggleTheme={() =>
          setTheme((current) => (current === 'light' ? 'dark' : 'light'))
        }
        onOpenSettings={() => {
          setSettingsFocus(null)
          setSettingsOpen(true)
        }}
      />

      <main className="main-content">
        <TopBar
          view={view}
          monthKey={monthKey}
          onMonthShift={handleMonthShift}
          onThisMonth={() => setMonthKey(currentMonthKey())}
          onAdd={openAdd}
          onOpenSettings={() => {
            setSettingsFocus(null)
            setSettingsOpen(true)
          }}
        />

        {view === 'overview' ? (
          <Overview
            transactions={transactions}
            projects={projects}
            monthKey={monthKey}
            budgetMetrics={budgetMetrics}
            rangeMetrics={monthRangeMetrics}
            openingBalance={openingBalance}
            onAdd={openAdd}
            onEdit={openEdit}
            onDelete={handleDeleteTransaction}
            onChangeView={handleChangeView}
            onOpenBudget={() => {
              setSettingsFocus('budget')
              setSettingsOpen(true)
            }}
            onOpenRangeBudget={() => {
              setSettingsFocus('budget-ranges')
              setSettingsOpen(true)
            }}
            onOpenOpeningBalance={() => {
              setSettingsFocus('opening-balance')
              setSettingsOpen(true)
            }}
            onLoadSample={handleLoadSample}
          />
        ) : null}

        {view === 'transactions' ? (
          <Transactions
            transactions={transactions}
            projects={projects}
            categories={categories}
            accounts={accounts}
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
            onDeleteProject={handleDeleteProject}
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
            budgetMetrics={budgetMetrics}
            rangeMetrics={monthRangeMetrics}
            onAdd={openAdd}
            onChangeView={handleChangeView}
            onOpenBudget={() => {
              setSettingsFocus('budget')
              setSettingsOpen(true)
            }}
            onOpenRangeBudget={() => {
              setSettingsFocus('budget-ranges')
              setSettingsOpen(true)
            }}
            onLoadSample={handleLoadSample}
          />
        ) : null}

        {view === 'liabilities' ? (
          <Liabilities
            liabilities={liabilities}
            onCreate={handleCreateLiability}
            onUpdate={handleUpdateLiability}
            onDelete={handleDeleteLiability}
            onAddRepayment={handleAddRepayment}
            onDeleteRepayment={handleDeleteRepayment}
          />
        ) : null}

        {view === 'indices' ? (
          <Indices
            transactions={transactions}
            liabilities={liabilities}
            openingBalance={openingBalance}
            monthKey={monthKey}
            onAdd={openAdd}
            onLoadSample={handleLoadSample}
            onChangeView={handleChangeView}
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
        categories={categories}
        accounts={accounts}
        defaultDate={defaultDateForMonth(monthKey)}
        defaultProjectId={transactionProjectId ?? undefined}
        onClose={closeTransactionModal}
        onSave={handleSaveTransaction}
        onDelete={handleDeleteTransaction}
        onCreateCategory={handleCreateCategory}
      />

      <SettingsModal
        open={settingsOpen}
        focusSection={settingsFocus}
        monthKey={monthKey}
        budgets={budgets}
        ranges={budgetRanges}
        transactions={transactions}
        countedProjectIds={countedProjectIds}
        openingBalance={openingBalance}
        theme={theme}
        palette={palette}
        fontSize={fontSize}
        currency={currency}
        reminders={reminders}
        categories={categories}
        accounts={accounts}
        categoryTransactionUsage={categoryTransactionUsage}
        categoryProjectUsage={categoryProjectUsage}
        accountTransactionUsage={accountTransactionUsage}
        updater={updater}
        onClose={() => {
          setSettingsOpen(false)
          setSettingsFocus(null)
        }}
        onBudgetSave={handleBudgetSave}
        onRangeSave={handleRangeSave}
        onRangeDelete={handleRangeDelete}
        onOpeningBalanceSave={handleOpeningBalanceSave}
        onCreateCategory={handleCreateCategory}
        onUpdateCategory={handleUpdateCategory}
        onDeleteCategory={handleDeleteCategory}
        onCreateAccount={handleCreateAccount}
        onRenameAccount={handleRenameAccount}
        onDeleteAccount={handleDeleteAccount}
        onThemeChange={setTheme}
        onPaletteChange={setPalette}
        onFontSizeChange={setFontSize}
        onCurrencyChange={handleCurrencyChange}
        onRemindersChange={setReminders}
        onNotify={showToast}
        onExportJson={handleExportJson}
        onExportCsv={handleExportCsv}
        onImportFile={handleImportFile}
        onReset={handleReset}
        onClear={handleClearLedger}
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
