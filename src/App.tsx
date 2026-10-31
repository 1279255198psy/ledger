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
import { RecurringRulesModal } from './components/RecurringRulesModal'
import { SettingsModal } from './components/SettingsModal'
import { ImportWizard } from './components/ImportWizard'
import { transactionsToExchangeCsv } from './lib/exchange/export'
import {
  clearLastImport,
  loadLastImport,
  removeImportBatch,
  saveLastImport,
  unusedCreatedAccounts,
  unusedCreatedCategories,
  type LastImport,
} from './lib/exchange/batch'
import { getAdapter } from './lib/exchange/adapters'
import type { ImportPlan } from './lib/exchange/types'
import { UpdateDialog } from './components/UpdateDialog'
import { useUpdater } from './hooks/useUpdater'
import { useReminderScheduler } from './hooks/useReminderScheduler'
import { useCaptureInbox } from './hooks/useCaptureInbox'
import { onStorageError } from './lib/storageEvents'
import { createBackup, maybeCreateAutoBackup } from './lib/backup'
import type { PendingCapture } from './lib/capture/types'
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
  loadOnboardingDismissed,
  loadOpeningBalance,
  loadPalette,
  loadProjects,
  loadRecurringPending,
  loadRecurringRules,
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
  saveOnboardingDismissed,
  saveOpeningBalance,
  savePalette,
  saveProjects,
  saveRecurringPending,
  saveRecurringRules,
  saveReminders,
  saveTheme,
  saveTransactions,
} from './lib/storage'
import {
  applyBudgetAdjustment,
  getMonthBudgetMetrics,
  getRangeBudgetMetrics,
  rangeOverlapsMonth,
  rescheduleRemainingDailyAmounts,
  resolveMonthBudget,
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
  addDays,
  firstOccurrenceOnOrAfter,
  newRecurringRuleId,
  nextDueDate,
  planRecurringCatchUp,
  reanchorFrequency,
  recurringTransactionId,
} from './lib/recurring'
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
  RecurringPending,
  RecurringRule,
  RecurringTemplate,
  ReminderSettings,
  RepaymentDraft,
  Theme,
  TransactionDraft,
  TransactionDraftSeed,
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

function templateFromDraft(draft: TransactionDraft): RecurringTemplate {
  return {
    type: draft.type,
    amountCents: draft.amountCents,
    categoryId: draft.categoryId,
    accountId: draft.accountId,
    note: draft.note,
    ...(draft.type === 'expense' && draft.spendingNature
      ? { spendingNature: draft.spendingNature }
      : {}),
    allocations:
      draft.allocations && draft.allocations.length > 0
        ? draft.allocations
        : [makeDailyAllocation(draft.amountCents)],
  }
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
  const [recurringRules, setRecurringRules] =
    useState<RecurringRule[]>(loadRecurringRules)
  const [recurringPending, setRecurringPending] =
    useState<RecurringPending[]>(loadRecurringPending)
  const [todayKey, setTodayKey] = useState(localDateKey)
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
  const [rulesModalOpen, setRulesModalOpen] = useState(false)
  const [ruleForm, setRuleForm] = useState<RecurringRule | 'new' | null>(null)
  const [pendingRecurring, setPendingRecurring] =
    useState<RecurringPending | null>(null)
  const [returnToRules, setReturnToRules] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [lastImport, setLastImport] = useState<LastImport | null>(loadLastImport)
  const [settingsFocus, setSettingsFocus] = useState<
    | 'opening-balance'
    | 'budget'
    | 'budget-ranges'
    | 'reminders'
    | 'guide'
    | null
  >(null)
  const [onboardingDismissed, setOnboardingDismissed] = useState(
    loadOnboardingDismissed,
  )
  const [toast, setToast] = useState<ToastState | null>(null)
  const updater = useUpdater()

  // Automatic bookkeeping: notifications become local pending items. They do
  // not enter the synced snapshot until the user annotates and saves one.
  const [annotatingCapture, setAnnotatingCapture] =
    useState<PendingCapture | null>(null)
  const captureInbox = useCaptureInbox(accounts, (count) => {
    setToast({
      id: Date.now(),
      message: `收到 ${count} 笔待标注记录`,
      kind: 'success',
    })
  })
  const pendingCaptures = useMemo(
    () => captureInbox.items.filter((item) => item.status === 'pending'),
    [captureInbox.items],
  )
  const pendingCaptureTotalCents = useMemo(
    () =>
      pendingCaptures.reduce(
        (sum, item) =>
          item.direction === 'expense' ? sum + (item.amountCents ?? 0) : sum,
        0,
      ),
    [pendingCaptures],
  )
  const captureSeed = useMemo<TransactionDraftSeed | null>(() => {
    if (!annotatingCapture) return null
    return {
      type: annotatingCapture.direction === 'income' ? 'income' : 'expense',
      amountCents: annotatingCapture.amountCents ?? undefined,
      categoryId: '',
      accountId: annotatingCapture.accountId || undefined,
      date: annotatingCapture.date,
      note: annotatingCapture.merchant,
      // A refund is filed as an expense against the original category, which
      // is what "冲减" needs; it must never land in the income column.
      kind:
        annotatingCapture.direction === 'refund' ? 'refund' : undefined,
    }
  }, [annotatingCapture])
  const captureHint = annotatingCapture
    ? `来自${
        annotatingCapture.sources[0]?.appLabel ?? '付款通知'
      }${
        annotatingCapture.confidence === 'low'
          ? '，部分信息识别不确定，请核对'
          : ''
      }。补上分类和支出性质后保存。`
    : undefined

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
    saveRecurringRules(recurringRules)
  }, [recurringRules])

  useEffect(() => {
    saveRecurringPending(recurringPending)
  }, [recurringPending])

  // Re-check the calendar twice an hour and whenever the app returns to the
  // foreground, so a ledger left open overnight still catches up at midnight.
  useEffect(() => {
    const refresh = () => setTodayKey(localDateKey())
    const timer = window.setInterval(refresh, 30 * 60 * 1000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  // The only place recurring entries enter the ledger. Deterministic ids make
  // repeated runs (StrictMode, two devices, a sync in between) idempotent.
  useEffect(() => {
    const plan = planRecurringCatchUp({
      rules: recurringRules,
      transactions,
      pending: recurringPending,
      categories,
      accounts,
      projects,
      today: todayKey,
    })
    if (!plan.changed) return

    setRecurringRules(plan.rules)
    if (plan.newTransactions.length > 0) {
      setTransactions((current) => {
        const ids = new Set(current.map((item) => item.id))
        const added = plan.newTransactions.filter(
          (item) => !ids.has(item.id),
        )
        return added.length === 0
          ? current
          : sortTransactions([...added, ...current])
      })
    }
    if (plan.newPendings.length > 0) {
      setRecurringPending((current) => {
        const ids = new Set(current.map((item) => item.id))
        const added = plan.newPendings.filter(
          (item) => !ids.has(item.id),
        )
        return added.length === 0 ? current : [...added, ...current]
      })
    }
  }, [
    todayKey,
    recurringRules,
    recurringPending,
    transactions,
    categories,
    accounts,
    projects,
  ])

  useEffect(() => {
    saveOpeningBalance(openingBalance)
  }, [openingBalance])

  useEffect(() => {
    void initSync()
  }, [])

  // One automatic snapshot per day, checked at launch and whenever the app
  // comes back to the foreground. A failed backup never blocks bookkeeping.
  useEffect(() => {
    const check = () => {
      void maybeCreateAutoBackup().catch((error) => {
        console.error('自动备份失败', error)
      })
    }
    check()
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () =>
      document.removeEventListener('visibilitychange', onVisibilityChange)
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
      setRecurringRules(loadRecurringRules())
      setRecurringPending(loadRecurringPending())
      setOpeningBalance(loadOpeningBalance())
      setEditing(null)
      setTransactionModalOpen(false)
      setTransactionProjectId(null)
      setRuleForm(null)
      setPendingRecurring(null)
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

  // A full storage area used to fail silently; surface it before the user
  // loses an entry they believed was saved.
  useEffect(
    () =>
      onStorageError((message) => {
        setToast({ id: Date.now(), message, kind: 'error' })
      }),
    [],
  )

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
    setAnnotatingCapture(null)
    setRuleForm(null)
    setPendingRecurring(null)
    setReturnToRules(false)
    setTransactionModalOpen(true)
  }

  const openAddForProject = (projectId: string) => {
    setEditing(null)
    setTransactionProjectId(projectId)
    setAnnotatingCapture(null)
    setRuleForm(null)
    setPendingRecurring(null)
    setReturnToRules(false)
    setTransactionModalOpen(true)
  }

  const openEdit = (transaction: LedgerTransaction) => {
    setEditing(transaction)
    setTransactionProjectId(null)
    setAnnotatingCapture(null)
    setRuleForm(null)
    setPendingRecurring(null)
    setReturnToRules(false)
    setTransactionModalOpen(true)
  }

  const openCaptureAnnotation = (item: PendingCapture) => {
    setEditing(null)
    setTransactionProjectId(null)
    setAnnotatingCapture(item)
    setRuleForm(null)
    setPendingRecurring(null)
    setReturnToRules(false)
    setTransactionModalOpen(true)
  }

  const openRuleForm = (rule: RecurringRule | 'new') => {
    setEditing(null)
    setTransactionProjectId(null)
    setAnnotatingCapture(null)
    setPendingRecurring(null)
    setReturnToRules(rulesModalOpen)
    setRulesModalOpen(false)
    setRuleForm(rule)
    setTransactionModalOpen(true)
  }

  const openRecurringPending = (item: RecurringPending) => {
    setEditing(null)
    setTransactionProjectId(null)
    setAnnotatingCapture(null)
    setRuleForm(null)
    setReturnToRules(false)
    setRulesModalOpen(false)
    setPendingRecurring(item)
    setTransactionModalOpen(true)
  }

  const handleIgnoreCapture = (id: string) => {
    captureInbox.ignore(id)
    showToast('这笔待标注已忽略')
  }

  const closeTransactionModal = () => {
    setTransactionModalOpen(false)
    setEditing(null)
    setTransactionProjectId(null)
    setAnnotatingCapture(null)
    setRuleForm(null)
    setPendingRecurring(null)
    if (returnToRules) {
      setRulesModalOpen(true)
      setReturnToRules(false)
    }
  }

  const handleSaveRecurringRule = (draft: TransactionDraft) => {
    const recurring = draft.recurring
    if (!recurring) {
      showToast('请先填写周期设置', 'error')
      return
    }
    const now = new Date().toISOString()
    const template = templateFromDraft(draft)

    if (ruleForm && ruleForm !== 'new') {
      const existing = ruleForm
      const scheduleChanged =
        existing.startDate !== recurring.startDate ||
        JSON.stringify(existing.frequency) !==
          JSON.stringify(recurring.frequency)
      // A schedule edit should not back-fill periods the user did not see.
      // Keep the cursor if it already sits past yesterday (today's period was
      // already generated or skipped), otherwise skip the paused gap.
      const yesterday = addDays(localDateKey(), -1)
      const through =
        existing.generatedThrough && existing.generatedThrough > yesterday
          ? existing.generatedThrough
          : yesterday
      setRecurringRules((current) =>
        current.map((rule) => {
          if (rule.id !== existing.id) return rule
          const next: RecurringRule = {
            ...rule,
            template,
            frequency: recurring.frequency,
            startDate: recurring.startDate,
            mode: recurring.mode,
            updatedAt: now,
          }
          if (recurring.endDate) next.endDate = recurring.endDate
          else delete next.endDate
          if (scheduleChanged) next.generatedThrough = through
          return next
        }),
      )
      showToast('周期规则已更新')
    } else {
      const rule: RecurringRule = {
        id: newRecurringRuleId(),
        schemaVersion: 1,
        enabled: true,
        template,
        frequency: recurring.frequency,
        startDate: recurring.startDate,
        ...(recurring.endDate ? { endDate: recurring.endDate } : {}),
        mode: recurring.mode,
        createdAt: now,
        updatedAt: now,
      }
      setRecurringRules((current) => [...current, rule])
      showToast(
        recurring.mode === 'confirm'
          ? '周期规则已创建，到期的账会先等你确认'
          : '周期规则已创建，到期的账会自动记上',
      )
    }
    closeTransactionModal()
  }

  const confirmPendingRecurring = (draft: TransactionDraft) => {
    const item = pendingRecurring
    if (!item) return
    const id = recurringTransactionId(item.ruleId, item.date)
    // Allocation ids are derived from the transaction id too: a confirmation
    // made on both devices then produces byte-identical records instead of a
    // conflict over a random id.
    const allocations = resolveDraftAllocations(draft, null).map(
      (line, index) => ({
        ...line,
        id: `${id}-al-${index + 1}`,
      }),
    )
    const created: LedgerTransaction = {
      id,
      schemaVersion: 2,
      type: draft.type,
      amountCents: draft.amountCents,
      categoryId: draft.categoryId,
      accountId: draft.accountId,
      date: item.date,
      note: draft.note,
      ...(draft.type === 'expense' && draft.spendingNature
        ? { spendingNature: draft.spendingNature }
        : {}),
      allocations,
      // Deterministic timestamps keep a simultaneous confirmation on both
      // devices byte-identical.
      createdAt: `${item.date}T00:00:00.000Z`,
      recurringRuleId: item.ruleId,
      recurringPeriod: item.date,
    }
    setTransactions((current) =>
      sortTransactions([
        created,
        ...current.filter((transaction) => transaction.id !== id),
      ]),
    )
    setRecurringPending((current) =>
      current.filter((pending) => pending.id !== item.id),
    )
    const targetMonth = monthOfDateKey(item.date)
    if (targetMonth !== monthKey && targetMonth <= latestMonth) {
      setMonthKey(targetMonth)
    }
    showToast(
      `已确认 ${formatMoney(draft.amountCents / 100)} 的周期记账`,
    )
    closeTransactionModal()
  }

  const handleSkipRecurring = (item: RecurringPending) => {
    setRecurringPending((current) =>
      current.filter((pending) => pending.id !== item.id),
    )
    showToast('已跳过这一期周期记账')
  }

  const handleToggleRecurringRule = (rule: RecurringRule) => {
    const now = new Date().toISOString()
    setRecurringRules((current) =>
      current.map((item) => {
        if (item.id !== rule.id) return item
        if (item.enabled) {
          return {
            ...item,
            enabled: false,
            stoppedAt: now,
            updatedAt: now,
          }
        }
        // Resume skips the paused gap but still lets today's due period in.
        const yesterday = addDays(localDateKey(), -1)
        const through =
          item.generatedThrough && item.generatedThrough > yesterday
            ? item.generatedThrough
            : yesterday
        const next: RecurringRule = {
          ...item,
          enabled: true,
          generatedThrough: through,
          updatedAt: now,
        }
        delete next.stoppedAt
        return next
      }),
    )
    showToast(rule.enabled ? '周期规则已暂停' : '周期规则已启用')
  }

  const handleDeleteRecurringRule = async (id: string) => {
    const rule = recurringRules.find((item) => item.id === id)
    if (!rule) return
    const confirmed = await confirmDesktopAction(
      `确定删除这条周期规则吗？已经生成的流水会保留，之后不再自动生成。`,
      '删除周期规则',
    )
    if (!confirmed) return
    setRecurringRules((current) =>
      current.filter((item) => item.id !== id),
    )
    setRecurringPending((current) =>
      current.filter((item) => item.ruleId !== id),
    )
    showToast('周期规则已删除')
  }

  const handleSaveTransaction = (draft: TransactionDraft) => {
    if (ruleForm) {
      handleSaveRecurringRule(draft)
      return
    }
    if (pendingRecurring) {
      confirmPendingRecurring(draft)
      return
    }

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
      kind: draft.type === 'expense' ? draft.kind : undefined,
      allocations,
    }

    if (editing) {
      const updatedAt = new Date().toISOString()
      const linkedRule = editing.recurringRuleId
        ? recurringRules.find(
            (rule) => rule.id === editing.recurringRuleId,
          ) ?? null
        : null
      const scope = draft.recurringEditScope
      const detach =
        linkedRule && !editing.recurringDetached && scope === 'once'
      setTransactions((current) =>
        sortTransactions(
          current.map((item) =>
            item.id === editing.id
              ? {
                  ...item,
                  ...base,
                  updatedAt,
                  ...(detach ? { recurringDetached: true } : {}),
                }
              : item,
          ),
        ),
      )

      if (linkedRule && scope === 'future') {
        const template = templateFromDraft(draft)
        const dateChanged = draft.date !== editing.date
        setRecurringRules((current) =>
          current.map((rule) => {
            if (rule.id !== linkedRule.id) return rule
            const frequency = dateChanged
              ? reanchorFrequency(rule.frequency, draft.date)
              : rule.frequency
            // Re-anchoring makes the edited date a period again. Advance the
            // cursor past it so catch-up does not record the same period twice
            // under its new deterministic id.
            const through =
              dateChanged &&
              frequency.kind !== 'interval' &&
              (!rule.generatedThrough || rule.generatedThrough < draft.date)
                ? draft.date
                : rule.generatedThrough
            return {
              ...rule,
              template,
              frequency,
              ...(through ? { generatedThrough: through } : {}),
              updatedAt,
            }
          }),
        )
      } else if (linkedRule && scope === 'stop') {
        setRecurringRules((current) =>
          current.map((rule) =>
            rule.id === linkedRule.id
              ? {
                  ...rule,
                  enabled: false,
                  stoppedAt: updatedAt,
                  updatedAt,
                }
              : rule,
          ),
        )
        setRecurringPending((current) =>
          current.filter(
            (pending) => pending.ruleId !== linkedRule.id,
          ),
        )
      }

      showToast(
        scope === 'stop'
          ? '这笔已更新，周期规则已停止'
          : scope === 'future'
            ? '这次及以后的周期记账已更新'
            : '这笔记录已更新',
      )
    } else {
      let created: LedgerTransaction = {
        ...base,
        id: newTransactionId(),
        createdAt: new Date().toISOString(),
      }
      if (draft.recurring) {
        const now = new Date().toISOString()
        const rule: RecurringRule = {
          id: newRecurringRuleId(),
          schemaVersion: 1,
          enabled: true,
          template: templateFromDraft(draft),
          frequency: draft.recurring.frequency,
          startDate: draft.recurring.startDate,
          ...(draft.recurring.endDate
            ? { endDate: draft.recurring.endDate }
            : {}),
          mode: draft.recurring.mode,
          createdAt: now,
          updatedAt: now,
        }
        const first = firstOccurrenceOnOrAfter(
          rule.frequency,
          rule.startDate,
          draft.date,
        )
        // When this entry itself is the first due period, link it and move the
        // cursor so the catch-up pass does not record it a second time.
        if (first === draft.date) {
          rule.generatedThrough = draft.date
          const id = recurringTransactionId(rule.id, draft.date)
          created = {
            ...created,
            id,
            allocations: created.allocations.map((line, index) => ({
              ...line,
              id: `${id}-al-${index + 1}`,
            })),
            createdAt: `${draft.date}T00:00:00.000Z`,
            recurringRuleId: rule.id,
            recurringPeriod: draft.date,
          }
        }
        setRecurringRules((current) => [...current, rule])
      }
      setTransactions((current) => sortTransactions([created, ...current]))
      if (annotatingCapture) {
        // Link the saved entry back to the notification, then drop it from
        // the pending queue.
        captureInbox.accept(
          annotatingCapture.id,
          created.id,
          draft.accountId,
        )
      }
      showToast(
        draft.type === 'income'
          ? `已记下收入 ${formatMoney(draft.amountCents / 100)}`
          : draft.kind === 'refund'
            ? `已记下退款 ${formatMoney(draft.amountCents / 100)}，冲减该分类支出`
            : `已记下支出 ${formatMoney(draft.amountCents / 100)}`,
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

  const handleBudgetAdjust = (
    targetMonth: string,
    amountCents: number,
    note: string,
    rescheduleDaily: boolean,
  ) => {
    setBudgets((current) => {
      const resolved = resolveMonthBudget(current, targetMonth).budget
      let next = resolved
      if (rescheduleDaily && resolved.dailyMode === 'manual') {
        const metrics = getMonthBudgetMetrics(
          transactions,
          targetMonth,
          current,
          countedProjectIds,
        )
        const dailyAmountsCents = rescheduleRemainingDailyAmounts(
          metrics,
          amountCents,
        )
        if (dailyAmountsCents) next = { ...next, dailyAmountsCents }
      }
      next = applyBudgetAdjustment(next, {
        amountCents,
        note,
        kind: 'adjust',
      })
      return { ...current, [targetMonth]: next }
    })
    showToast(`${monthLabel(targetMonth)}预算已调整，原因已记录`)
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
      recurringRules,
      recurringPending,
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
    const sorted = [...transactions].sort((a, b) => b.date.localeCompare(a.date))
    const csv = `﻿${transactionsToExchangeCsv(
      sorted,
      categories,
      accounts,
      projects,
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

  /** Best-effort snapshot taken just before a destructive operation. */
  const backupBefore = async (
    reason: 'before-import' | 'before-reset' | 'before-clear',
  ) => {
    try {
      await createBackup(reason)
    } catch (error) {
      console.error('自动备份失败', error)
      showToast('自动备份失败，继续操作前建议先导出备份', 'error')
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
      await backupBefore('before-import')
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
      const nextRules = imported.recurringRules ?? recurringRules
      setRecurringRules(nextRules)
      const nextPending =
        imported.recurringPending ?? recurringPending
      const ruleIds = new Set(nextRules.map((rule) => rule.id))
      setRecurringPending(
        nextPending.filter((pending) => ruleIds.has(pending.ruleId)),
      )
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

  /**
   * Commits one import batch. The caller has already shown a preview; this
   * only writes, remembers the batch for undo, and reports the count.
   */
  const handleImportCommit = async (plan: ImportPlan) => {
    await backupBefore('before-import')
    if (plan.newCategories.length > 0) {
      commitCategories([...categories, ...plan.newCategories])
    }
    if (plan.newAccounts.length > 0) {
      commitAccounts([...accounts, ...plan.newAccounts])
    }
    setTransactions((current) =>
      sortTransactions([...plan.transactions, ...current]),
    )

    const info: LastImport = {
      batchId: plan.batchId,
      at: new Date().toISOString(),
      sourceLabel: getAdapter(plan.sourceId).label,
      count: plan.transactions.length,
      createdCategoryIds: plan.newCategories.map((category) => category.id),
      createdAccountIds: plan.newAccounts.map((account) => account.id),
    }
    saveLastImport(info)
    setLastImport(info)
    showToast(`已导入 ${plan.transactions.length} 笔流水`)
  }

  /** Removes one import batch and any categories/accounts it created alone. */
  const handleUndoImport = async (batchId?: string): Promise<boolean> => {
    const target = batchId ?? lastImport?.batchId
    if (!target) return false
    const confirmed = await confirmDesktopAction(
      '撤销这次导入吗？这批流水会被删除，其他流水不受影响。',
      '撤销导入',
    )
    if (!confirmed) return false

    const nextTransactions = removeImportBatch(transactions, target)
    const removed = transactions.length - nextTransactions.length
    setTransactions(nextTransactions)

    if (lastImport && lastImport.batchId === target) {
      // Only drop what this batch created and nothing else still points at.
      const budgetCategories = new Set<string>()
      for (const month of Object.values(budgets)) {
        for (const id of Object.keys(month.categoryBudgetsCents ?? {})) {
          budgetCategories.add(id)
        }
      }
      for (const range of budgetRanges) {
        for (const id of Object.keys(range.categoryBudgetsCents ?? {})) {
          budgetCategories.add(id)
        }
      }
      for (const project of projects) {
        for (const id of Object.keys(project.categoryBudgetsCents ?? {})) {
          budgetCategories.add(id)
        }
      }
      const dropCategories = unusedCreatedCategories(
        categories,
        nextTransactions,
        lastImport.createdCategoryIds,
      ).filter((id) => !budgetCategories.has(id))
      if (dropCategories.length > 0) {
        commitCategories(
          categories.filter((category) => !dropCategories.includes(category.id)),
        )
      }

      const recurringAccounts = new Set(
        recurringRules.map((rule) => rule.template.accountId),
      )
      const dropAccounts = unusedCreatedAccounts(
        accounts,
        nextTransactions,
        lastImport.createdAccountIds,
      ).filter((id) => !recurringAccounts.has(id))
      if (dropAccounts.length > 0) {
        commitAccounts(
          accounts.filter((account) => !dropAccounts.includes(account.id)),
        )
      }

      clearLastImport()
      setLastImport(null)
    }

    showToast(
      removed > 0 ? `已撤销这次导入的 ${removed} 笔流水` : '没有找到这批导入的流水',
    )
    return true
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
    setRecurringRules([])
    setRecurringPending([])
    setOpeningBalance(sample.openingBalanceCents / 100)
    setMonthKey(currentMonthKey())
    setView('overview')
  }

  const handleLoadSample = async () => {
    await backupBefore('before-reset')
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
    await backupBefore('before-reset')
    applySampleLedger()
    setSettingsOpen(false)
    showToast('示例账本已恢复')
  }

  const handleClearLedger = async () => {
    const syncHint = getSyncState().enabled
      ? '同步已开启，另一台设备上的账目也会被清除。'
      : ''
    const confirmed = await confirmDesktopAction(
      `确定清除现有账本吗？全部流水、项目、负债与周期规则会被删除，预算和起始资金会重置。分类与外观设置保留。此操作无法撤销，建议先导出备份。${syncHint}`,
      '清除现有账本',
    )
    if (!confirmed) return
    await backupBefore('before-clear')
    setTransactions([])
    setProjects([])
    setLiabilities([])
    setBudgets({})
    setBudgetRanges([])
    setRecurringRules([])
    setRecurringPending([])
    setOpeningBalance(0)
    setMonthKey(currentMonthKey())
    setSettingsOpen(false)
    setView('overview')
    showToast('账本已清除')
  }

  const linkedRule = useMemo(() => {
    if (!editing?.recurringRuleId || editing.recurringDetached) return null
    return (
      recurringRules.find(
        (rule) => rule.id === editing.recurringRuleId,
      ) ?? null
    )
  }, [editing, recurringRules])

  const sortedRecurringRules = useMemo(
    () =>
      [...recurringRules].sort((left, right) => {
        if (left.enabled !== right.enabled) return left.enabled ? -1 : 1
        const leftNext = nextDueDate(left) ?? '9999-12-31'
        const rightNext = nextDueDate(right) ?? '9999-12-31'
        return (
          leftNext.localeCompare(rightNext) ||
          right.updatedAt.localeCompare(left.updatedAt)
        )
      }),
    [recurringRules],
  )

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
            categories={categories}
            pendingCaptureCount={pendingCaptures.length}
            pendingCaptureTotalCents={pendingCaptureTotalCents}
            onOpenPendingCaptures={() => handleChangeView('transactions')}
            recurringPending={recurringPending}
            onConfirmRecurring={openRecurringPending}
            onSkipRecurring={handleSkipRecurring}
            onAdd={openAdd}
            onEdit={openEdit}
            onDelete={handleDeleteTransaction}
            onChangeView={handleChangeView}
            onOpenBudget={() => {
              setSettingsFocus('budget')
              setSettingsOpen(true)
            }}
            onBudgetAdjust={handleBudgetAdjust}
            onOpenRangeBudget={() => {
              setSettingsFocus('budget-ranges')
              setSettingsOpen(true)
            }}
            onOpenOpeningBalance={() => {
              setSettingsFocus('opening-balance')
              setSettingsOpen(true)
            }}
            onLoadSample={handleLoadSample}
            showOnboarding={!onboardingDismissed}
            hasMonthBudget={budgetMetrics.source !== 'default'}
            hasCategoryBudget={budgetMetrics.categories.length > 0}
            onOpenGuide={() => {
              setSettingsFocus('guide')
              setSettingsOpen(true)
            }}
            onDismissOnboarding={() => {
              saveOnboardingDismissed()
              setOnboardingDismissed(true)
            }}
          />
        ) : null}

        {view === 'transactions' ? (
          <Transactions
            transactions={transactions}
            projects={projects}
            categories={categories}
            accounts={accounts}
            monthKey={monthKey}
            pendingCaptures={pendingCaptures}
            recurringRules={sortedRecurringRules}
            recurringPending={recurringPending}
            onAdd={openAdd}
            onEdit={openEdit}
            onDelete={handleDeleteTransaction}
            onAnnotateCapture={openCaptureAnnotation}
            onIgnoreCapture={handleIgnoreCapture}
            onOpenRules={() => setRulesModalOpen(true)}
            onNewRule={() => openRuleForm('new')}
            onConfirmRecurring={openRecurringPending}
            onSkipRecurring={handleSkipRecurring}
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
            budgets={budgets}
            countedProjectIds={countedProjectIds}
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

      <RecurringRulesModal
        open={rulesModalOpen}
        rules={sortedRecurringRules}
        categories={categories}
        pendingCount={recurringPending.length}
        onClose={() => setRulesModalOpen(false)}
        onNew={() => openRuleForm('new')}
        onEdit={openRuleForm}
        onToggle={handleToggleRecurringRule}
        onDelete={handleDeleteRecurringRule}
      />

      <TransactionModal
        open={transactionModalOpen}
        editing={editing}
        projects={projects}
        categories={categories}
        accounts={accounts}
        defaultDate={defaultDateForMonth(monthKey)}
        defaultProjectId={transactionProjectId ?? undefined}
        initialDraft={captureSeed}
        captureHint={captureHint}
        ruleForm={ruleForm}
        pendingRecurring={pendingRecurring}
        linkedRule={linkedRule}
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
        onOpenImport={() => {
          setSettingsOpen(false)
          setSettingsFocus(null)
          setImportOpen(true)
        }}
        lastImport={lastImport}
        onUndoImport={() => void handleUndoImport()}
        onReset={handleReset}
        onClear={handleClearLedger}
      />

      {importOpen ? (
        <ImportWizard
          categories={categories}
          accounts={accounts}
          transactions={transactions}
          onClose={() => setImportOpen(false)}
          onCommit={handleImportCommit}
          onUndo={handleUndoImport}
        />
      ) : null}

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
