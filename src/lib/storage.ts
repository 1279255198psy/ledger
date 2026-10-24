import type {
  Account,
  BudgetBook,
  Category,
  Currency,
  FontSize,
  IndexGranularity,
  IndexMetricKey,
  IndexPreferences,
  LedgerTransaction,
  Liability,
  Palette,
  Project,
  RangeBudget,
  ReminderSettings,
  Theme,
} from '../types'
import {
  DEFAULT_ACCOUNTS,
  normalizeAccounts,
  setActiveAccounts,
} from './accounts'
import {
  isValidProject,
  migrateV1Transaction,
  normalizeTransaction,
  sortTransactions,
} from './data'
import {
  DEFAULT_CATEGORIES,
  getActiveCategories,
  normalizeCategories,
  setActiveCategories,
  withPresetSubcategories,
} from './categories'
import {
  isValidLiability,
  sortLiabilities,
} from './liabilities'
import { makeDailyAllocation } from './allocations'
import { isCurrency, normalizeCurrency } from './currency'
import { normalizeFontSize } from './fontSize'
import { DEFAULT_REMINDERS, normalizeReminders } from './reminders'
import { isPalette, normalizePalette } from './themes'
import {
  normalizeBudgetBook,
  normalizeRangeBudgets,
  resolveMonthBudget,
} from './budget'
import { currentMonthKey } from './utils'
import {
  isDesktopApp,
  loadDesktopLedger,
  saveDesktopLedger,
} from './desktop'
import type { LedgerDataSnapshot } from './sync/types'

const KEYS = {
  transactions: 'zhangye.transactions.v2',
  transactionsV1: 'zhangye.transactions.v1',
  categories: 'zhangye.categories.v1',
  categoryPresets: 'zhangye.categoryPresets.v1',
  accounts: 'zhangye.accounts.v1',
  projects: 'zhangye.projects.v1',
  liabilities: 'zhangye.liabilities.v1',
  budget: 'zhangye.budget.v2',
  budgetV1: 'zhangye.budget.v1',
  budgets: 'zhangye.budgets.v3',
  budgetRanges: 'zhangye.budgetRanges.v1',
  openingBalance: 'zhangye.openingBalanceCents.v1',
  theme: 'zhangye.theme.v1',
  palette: 'zhangye.palette.v1',
  fontSize: 'zhangye.fontSize.v1',
  currency: 'zhangye.currency.v1',
  indexPrefs: 'zhangye.indexPrefs.v1',
  reminders: 'zhangye.reminders.v1',
  seeded: 'zhangye.seeded.v1',
  updatedAt: 'zhangye.updatedAt.v1',
} as const

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // The app still works in-memory when storage is unavailable.
  }
}

interface DesktopLedgerSnapshot {
  app: string
  version: 2
  updatedAt: string
  categories: Category[]
  accounts?: Account[]
  projects: Project[]
  liabilities: Liability[]
  transactions: LedgerTransaction[]
  budgetCents: number
  budgets: BudgetBook
  budgetRanges: RangeBudget[]
  openingBalanceCents: number
  theme: Theme
  palette: Palette
  fontSize: FontSize
  currency: Currency
  indexPrefs: IndexPreferences
  reminders: ReminderSettings
  seeded: boolean
}

interface TransactionReadResult {
  transactions: LedgerTransaction[]
  migrated: boolean
}

let desktopHydrated = false
let persistTimer: number | null = null
let persistChain: Promise<void> = Promise.resolve()
let flushHooksInstalled = false

type LedgerChangeListener = () => void
const ledgerChangeListeners = new Set<LedgerChangeListener>()

/** Fires whenever books data is written locally (not for appearance settings). */
export function onLedgerChanged(listener: LedgerChangeListener): () => void {
  ledgerChangeListeners.add(listener)
  return () => ledgerChangeListeners.delete(listener)
}

function notifyLedgerChanged(): void {
  for (const listener of ledgerChangeListeners) {
    try {
      listener()
    } catch (error) {
      console.error('账本变化监听失败', error)
    }
  }
}

/**
 * Older ledgers have only top-level categories. Add the ready-made
 * subcategories once; the marker keeps presets from returning after the user
 * deliberately deletes them.
 */
function applyPresetMigration(categories: Category[]): Category[] {
  if (safeGet(KEYS.categoryPresets) === 'true') return categories
  const merged = withPresetSubcategories(categories)
  if (merged !== categories) {
    safeSet(KEYS.categories, JSON.stringify(merged))
  }
  safeSet(KEYS.categoryPresets, 'true')
  return merged
}

function readStoredCategories(): Category[] {
  const raw = safeGet(KEYS.categories)
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      const normalized = normalizeCategories(parsed)
      if (normalized) return applyPresetMigration(normalized)
    } catch {
      // An invalid category list falls back to the built-in set below.
    }
  }
  return applyPresetMigration(DEFAULT_CATEGORIES)
}

function readStoredAccounts(): Account[] {
  const raw = safeGet(KEYS.accounts)
  if (raw !== null) {
    try {
      const normalized = normalizeAccounts(JSON.parse(raw))
      if (normalized) return normalized
    } catch {
      // A broken account list falls back to the built-in wallets.
    }
  }
  return DEFAULT_ACCOUNTS
}

function readStoredTransactions(
  categories: Category[] = getActiveCategories(),
): TransactionReadResult {
  const rawV2 = safeGet(KEYS.transactions)
  if (rawV2 !== null) {
    try {
      const parsed: unknown = JSON.parse(rawV2)
      if (Array.isArray(parsed)) {
        const normalized = parsed.map((item) =>
          normalizeTransaction(item, categories),
        )
        const valid = normalized.filter(
          (item): item is LedgerTransaction => item !== null,
        )
        if (valid.length === normalized.length) {
          return { transactions: valid, migrated: false }
        }
      }
    } catch {
      // Do not fall back to the v1 key; it could resurrect data the user
      // already replaced. The app starts blank instead.
    }
    return { transactions: [], migrated: false }
  }

  const rawV1 = safeGet(KEYS.transactionsV1)
  if (rawV1 !== null) {
    try {
      const parsed: unknown = JSON.parse(rawV1)
      if (Array.isArray(parsed)) {
        const migrated = parsed.map((item) =>
          migrateV1Transaction(item, categories),
        )
        const valid = migrated.filter(
          (item): item is LedgerTransaction => item !== null,
        )
        if (valid.length === migrated.length) {
          return { transactions: valid, migrated: true }
        }
      }
    } catch {
      // Ignore invalid legacy data.
    }
  }

  return { transactions: [], migrated: false }
}

function readStoredProjects(
  categories: Category[] = getActiveCategories(),
): Project[] {
  const raw = safeGet(KEYS.projects)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => isValidProject(item, categories))
    ) {
      return parsed
    }
  } catch {
    // An invalid project list should not take the ledger down with it.
  }
  return []
}

function readStoredLiabilities(): Liability[] {
  const raw = safeGet(KEYS.liabilities)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      Array.isArray(parsed) &&
      parsed.every(isValidLiability)
    ) {
      return sortLiabilities(parsed)
    }
  } catch {
    // A broken liability list must not block the rest of the ledger.
  }
  return []
}

function readOpeningBalanceCents(): number {
  const raw = safeGet(KEYS.openingBalance)
  if (raw === null) return 0
  const cents = Number(raw)
  if (!Number.isFinite(cents) || cents < 0) return 0
  return Math.round(cents)
}

/** The single budget older versions stored; null when none was ever set. */
function readLegacyBudgetCents(): number | null {
  const rawV2 = safeGet(KEYS.budget)
  if (rawV2 !== null) {
    const cents = Number(rawV2)
    if (Number.isFinite(cents) && cents > 0) return Math.round(cents)
  }

  const rawV1 = safeGet(KEYS.budgetV1)
  if (rawV1 !== null) {
    const yuan = Number(rawV1)
    if (Number.isFinite(yuan) && yuan > 0) {
      const cents = Math.round(yuan * 100)
      safeSet(KEYS.budget, String(cents))
      return cents
    }
  }

  return null
}

function readStoredBudgets(): BudgetBook {
  const raw = safeGet(KEYS.budgets)
  if (raw !== null) {
    try {
      const parsed: unknown = JSON.parse(raw)
      const normalized = normalizeBudgetBook(parsed)
      if (normalized) return normalized
    } catch {
      // A broken budget book falls back to the legacy single budget below.
    }
  }

  const legacyCents = readLegacyBudgetCents()
  if (legacyCents !== null) {
    const month = currentMonthKey()
    const book: BudgetBook = {
      [month]: { month, amountCents: legacyCents, dailyMode: 'off' },
    }
    safeSet(KEYS.budgets, JSON.stringify(book))
    return book
  }

  return {}
}

function readStoredBudgetRanges(): RangeBudget[] {
  const raw = safeGet(KEYS.budgetRanges)
  if (raw === null) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return normalizeRangeBudgets(parsed) ?? []
  } catch {
    // A broken range list must not block the monthly budgets.
    return []
  }
}

function readStoredReminders(): ReminderSettings {
  const raw = safeGet(KEYS.reminders)
  if (raw === null) return { ...DEFAULT_REMINDERS }
  try {
    return normalizeReminders(JSON.parse(raw))
  } catch {
    // Reminder settings are cheap to rebuild; never block the ledger on them.
    return { ...DEFAULT_REMINDERS }
  }
}

function applyDesktopSnapshot(snapshot: Record<string, unknown>): void {
  // Categories must be resolved first: transaction and project validation
  // checks every category id against this list.
  let categories = readStoredCategories()
  if (Array.isArray(snapshot.categories)) {
    const normalized = normalizeCategories(snapshot.categories)
    if (normalized) {
      categories = applyPresetMigration(normalized)
      safeSet(KEYS.categories, JSON.stringify(categories))
    }
  }
  setActiveCategories(categories)

  if (Array.isArray(snapshot.accounts)) {
    const accounts = normalizeAccounts(snapshot.accounts)
    if (accounts) {
      safeSet(KEYS.accounts, JSON.stringify(accounts))
      setActiveAccounts(accounts)
    }
  } else {
    setActiveAccounts(readStoredAccounts())
  }

  if (Array.isArray(snapshot.liabilities)) {
    const liabilities = snapshot.liabilities.filter(isValidLiability)
    if (liabilities.length === snapshot.liabilities.length) {
      safeSet(
        KEYS.liabilities,
        JSON.stringify(sortLiabilities(liabilities)),
      )
    }
  }

  if (Array.isArray(snapshot.transactions)) {
    const normalized = snapshot.transactions.map((item) =>
      normalizeTransaction(item, categories),
    )
    const valid = normalized.filter(
      (item): item is LedgerTransaction => item !== null,
    )
    if (valid.length === normalized.length) {
      safeSet(
        KEYS.transactions,
        JSON.stringify(sortTransactions(valid)),
      )
    }
  }

  if (Array.isArray(snapshot.projects)) {
    const projects = snapshot.projects.filter((item) =>
      isValidProject(item, categories),
    )
    if (projects.length === snapshot.projects.length) {
      safeSet(KEYS.projects, JSON.stringify(projects))
    }
  }

  if (snapshot.budgets !== undefined) {
    const budgets = normalizeBudgetBook(snapshot.budgets)
    if (budgets) {
      safeSet(KEYS.budgets, JSON.stringify(budgets))
    }
  } else {
    const budgetCents =
      typeof snapshot.budgetCents === 'number'
        ? snapshot.budgetCents
        : typeof snapshot.budget === 'number'
          ? Math.round(snapshot.budget * 100)
          : null
    if (
      budgetCents !== null &&
      Number.isFinite(budgetCents) &&
      budgetCents > 0
    ) {
      const month = currentMonthKey()
      const book: BudgetBook = {
        [month]: { month, amountCents: Math.round(budgetCents), dailyMode: 'off' },
      }
      safeSet(KEYS.budgets, JSON.stringify(book))
      safeSet(KEYS.budget, String(Math.round(budgetCents)))
    }
  }

  if (snapshot.budgetRanges !== undefined) {
    const ranges = normalizeRangeBudgets(snapshot.budgetRanges)
    if (ranges) {
      safeSet(KEYS.budgetRanges, JSON.stringify(ranges))
    }
  }

  if (
    typeof snapshot.openingBalanceCents === 'number' &&
    Number.isFinite(snapshot.openingBalanceCents) &&
    snapshot.openingBalanceCents >= 0
  ) {
    safeSet(
      KEYS.openingBalance,
      String(Math.round(snapshot.openingBalanceCents)),
    )
  }

  if (snapshot.theme === 'light' || snapshot.theme === 'dark') {
    safeSet(KEYS.theme, snapshot.theme)
  }
  if (snapshot.palette === 'copper' || isPalette(snapshot.palette)) {
    safeSet(KEYS.palette, normalizePalette(snapshot.palette))
  }
  if (snapshot.fontSize !== undefined) {
    safeSet(KEYS.fontSize, normalizeFontSize(snapshot.fontSize))
  }
  if (isCurrency(snapshot.currency)) {
    safeSet(KEYS.currency, snapshot.currency)
  }
  const indexPrefs = normalizeIndexPreferences(snapshot.indexPrefs)
  if (indexPrefs) {
    safeSet(KEYS.indexPrefs, JSON.stringify(indexPrefs))
  }
  if (snapshot.reminders !== undefined) {
    safeSet(KEYS.reminders, JSON.stringify(normalizeReminders(snapshot.reminders)))
  }
  if (typeof snapshot.seeded === 'boolean') {
    safeSet(KEYS.seeded, String(snapshot.seeded))
  }
  if (typeof snapshot.updatedAt === 'string') {
    safeSet(KEYS.updatedAt, snapshot.updatedAt)
  }
}

function readDesktopSnapshot(): DesktopLedgerSnapshot {
  const categories = readStoredCategories()
  const { transactions } = readStoredTransactions(categories)
  const storedTheme = safeGet(KEYS.theme)
  const storedPalette = safeGet(KEYS.palette)
  const budgets = readStoredBudgets()
  const currentBudgetCents = resolveMonthBudget(
    budgets,
    currentMonthKey(),
  ).budget.amountCents

  return {
    app: '账页',
    version: 2,
    updatedAt: safeGet(KEYS.updatedAt) ?? new Date().toISOString(),
    categories,
    accounts: readStoredAccounts(),
    projects: readStoredProjects(categories),
    liabilities: readStoredLiabilities(),
    transactions,
    budgetCents: currentBudgetCents,
    budgets,
    budgetRanges: readStoredBudgetRanges(),
    openingBalanceCents: readOpeningBalanceCents(),
    theme: storedTheme === 'dark' ? 'dark' : 'light',
    palette: normalizePalette(storedPalette),
    fontSize: normalizeFontSize(safeGet(KEYS.fontSize)),
    currency: normalizeCurrency(safeGet(KEYS.currency)),
    indexPrefs: loadIndexPreferences(),
    reminders: readStoredReminders(),
    seeded: safeGet(KEYS.seeded) === 'true',
  }
}

/**
 * The financial part of the ledger, used by the sync engine. Appearance,
 * currency and reminder preferences deliberately stay out of it.
 */
export function readLedgerDataSnapshot(): LedgerDataSnapshot {
  const categories = readStoredCategories()
  const { transactions } = readStoredTransactions(categories)
  return {
    app: '账页',
    syncVersion: 1,
    updatedAt: new Date().toISOString(),
    categories,
    accounts: readStoredAccounts(),
    transactions,
    projects: readStoredProjects(categories),
    liabilities: readStoredLiabilities(),
    budgets: readStoredBudgets(),
    budgetRanges: readStoredBudgetRanges(),
    openingBalanceCents: readOpeningBalanceCents(),
  }
}

/**
 * Writes a merged snapshot and rebuilds the storage mirror. Validation happens
 * before the first write, so a malformed remote snapshot cannot half-apply.
 */
export function applyLedgerDataSnapshot(
  snapshot: LedgerDataSnapshot,
): LedgerDataSnapshot {
  const categories = normalizeCategories(snapshot.categories)
  if (!categories) {
    throw new Error('同步数据中的分类无法识别')
  }

  // Older snapshots did not carry accounts; keep the local cards in that case.
  const accounts = snapshot.accounts
    ? normalizeAccounts(snapshot.accounts)
    : readStoredAccounts()
  if (!accounts) {
    throw new Error('同步数据中的账户无法识别')
  }

  const transactions = snapshot.transactions.map((item) =>
    normalizeTransaction(item, categories),
  )
  if (transactions.some((item) => item === null)) {
    throw new Error('同步数据中的流水无法识别')
  }
  const validTransactions = transactions as LedgerTransaction[]

  const projects = snapshot.projects.filter((item) =>
    isValidProject(item, categories),
  )
  if (projects.length !== snapshot.projects.length) {
    throw new Error('同步数据中的项目无法识别')
  }

  const liabilities = snapshot.liabilities.filter(isValidLiability)
  if (liabilities.length !== snapshot.liabilities.length) {
    throw new Error('同步数据中的负债无法识别')
  }

  const budgets = normalizeBudgetBook(snapshot.budgets)
  if (!budgets) {
    throw new Error('同步数据中的预算无法识别')
  }

  const budgetRanges = normalizeRangeBudgets(snapshot.budgetRanges)
  if (!budgetRanges) {
    throw new Error('同步数据中的区间预算无法识别')
  }

  const openingBalanceCents = snapshot.openingBalanceCents
  if (
    typeof openingBalanceCents !== 'number' ||
    !Number.isFinite(openingBalanceCents) ||
    openingBalanceCents < 0
  ) {
    throw new Error('同步数据中的起始资金无法识别')
  }

  const updatedAt = new Date().toISOString()
  safeSet(KEYS.categories, JSON.stringify(categories))
  safeSet(KEYS.accounts, JSON.stringify(accounts))
  safeSet(KEYS.transactions, JSON.stringify(sortTransactions(validTransactions)))
  safeSet(KEYS.seeded, 'true')
  safeSet(KEYS.projects, JSON.stringify(projects))
  safeSet(KEYS.liabilities, JSON.stringify(sortLiabilities(liabilities)))
  safeSet(KEYS.budgets, JSON.stringify(budgets))
  const currentBudget = resolveMonthBudget(budgets, currentMonthKey()).budget
  safeSet(KEYS.budget, String(currentBudget.amountCents))
  safeSet(KEYS.budgetRanges, JSON.stringify(budgetRanges))
  safeSet(KEYS.openingBalance, String(Math.round(openingBalanceCents)))
  safeSet(KEYS.updatedAt, updatedAt)
  setActiveCategories(categories)
  setActiveAccounts(accounts)
  scheduleDesktopPersist()

  return {
    app: '账页',
    syncVersion: 1,
    updatedAt,
    categories,
    accounts,
    transactions: sortTransactions(validTransactions),
    projects,
    liabilities: sortLiabilities(liabilities),
    budgets,
    budgetRanges,
    openingBalanceCents: Math.round(openingBalanceCents),
  }
}

export function flushDesktopPersist(): Promise<void> {
  if (!isDesktopApp()) return Promise.resolve()
  const snapshot = readDesktopSnapshot()
  persistChain = persistChain
    .catch(() => undefined)
    .then(() => saveDesktopLedger(snapshot))
    .catch((error) => {
      console.error('保存本地账本文件失败', error)
    })
  return persistChain
}

function scheduleDesktopPersist(): void {
  if (!isDesktopApp()) return
  // Update the mirror timestamp immediately. If the app closes before the
  // debounced file write completes, the next launch can still choose the newer
  // localStorage copy instead of overwriting it with a stale file.
  safeSet(KEYS.updatedAt, new Date().toISOString())
  if (persistTimer !== null) window.clearTimeout(persistTimer)
  persistTimer = window.setTimeout(() => {
    persistTimer = null
    void flushDesktopPersist()
  }, 120)
}

function installFlushHooks(): void {
  if (flushHooksInstalled || typeof window === 'undefined') return
  flushHooksInstalled = true
  window.addEventListener('pagehide', () => {
    if (persistTimer === null) return
    window.clearTimeout(persistTimer)
    persistTimer = null
    void flushDesktopPersist()
  })
}

/**
 * Loads the desktop ledger file into the localStorage mirror before React
 * mounts, so the existing synchronous storage API can stay unchanged.
 */
export async function hydrateDesktopStorage(): Promise<void> {
  if (!isDesktopApp() || desktopHydrated) return
  desktopHydrated = true

  try {
    const stored = await loadDesktopLedger()
    if (!stored) {
      if (
        safeGet(KEYS.transactions) !== null ||
        safeGet(KEYS.transactionsV1) !== null ||
        safeGet(KEYS.seeded) !== null
      ) {
        scheduleDesktopPersist()
      }
      return
    }

    if (!stored || typeof stored !== 'object') return
    const snapshot = stored as Record<string, unknown>
    const localUpdatedAt = safeGet(KEYS.updatedAt) ?? ''
    const fileUpdatedAt =
      typeof snapshot.updatedAt === 'string' ? snapshot.updatedAt : ''

    if (!localUpdatedAt || fileUpdatedAt >= localUpdatedAt) {
      applyDesktopSnapshot(snapshot)
    } else {
      scheduleDesktopPersist()
    }
  } catch (error) {
    console.error('无法读取本地账本文件，将使用本地缓存继续运行。', error)
  } finally {
    installFlushHooks()
  }
}

export function loadAccounts(): Account[] {
  const accounts = readStoredAccounts()
  setActiveAccounts(accounts)
  return accounts
}

export function saveAccounts(accounts: Account[]): void {
  safeSet(KEYS.accounts, JSON.stringify(accounts))
  setActiveAccounts(accounts)
  scheduleDesktopPersist()
  notifyLedgerChanged()
}

export function loadCategories(): Category[] {
  const categories = readStoredCategories()
  setActiveCategories(categories)
  return categories
}

export function saveCategories(categories: Category[]): void {
  safeSet(KEYS.categories, JSON.stringify(categories))
  scheduleDesktopPersist()
  notifyLedgerChanged()
}

export function loadTransactions(): LedgerTransaction[] {
  const { transactions, migrated } = readStoredTransactions()
  if (migrated) {
    safeSet(KEYS.transactions, JSON.stringify(transactions))
  }
  safeSet(KEYS.seeded, 'true')
  return sortTransactions(transactions)
}

export function saveTransactions(transactions: LedgerTransaction[]): void {
  safeSet(KEYS.transactions, JSON.stringify(transactions))
  safeSet(KEYS.seeded, 'true')
  scheduleDesktopPersist()
  notifyLedgerChanged()
}

export function loadProjects(): Project[] {
  return readStoredProjects(getActiveCategories())
}

export function saveProjects(projects: Project[]): void {
  safeSet(KEYS.projects, JSON.stringify(projects))
  scheduleDesktopPersist()
  notifyLedgerChanged()
}

export function loadLiabilities(): Liability[] {
  return readStoredLiabilities()
}

export function saveLiabilities(liabilities: Liability[]): void {
  safeSet(KEYS.liabilities, JSON.stringify(liabilities))
  scheduleDesktopPersist()
  notifyLedgerChanged()
}

export function loadBudgets(): BudgetBook {
  return readStoredBudgets()
}

export function saveBudgets(budgets: BudgetBook): void {
  safeSet(KEYS.budgets, JSON.stringify(budgets))
  // Keep the single-budget key in step with the current month so older builds
  // and older desktop snapshots still see a sensible number.
  const current = resolveMonthBudget(budgets, currentMonthKey()).budget
  safeSet(KEYS.budget, String(current.amountCents))
  scheduleDesktopPersist()
  notifyLedgerChanged()
}

export function loadBudgetRanges(): RangeBudget[] {
  return readStoredBudgetRanges()
}

export function saveBudgetRanges(ranges: RangeBudget[]): void {
  safeSet(KEYS.budgetRanges, JSON.stringify(ranges))
  scheduleDesktopPersist()
  notifyLedgerChanged()
}

export function loadOpeningBalance(): number {
  return readOpeningBalanceCents() / 100
}

export function saveOpeningBalance(balance: number): void {
  safeSet(KEYS.openingBalance, String(Math.round(balance * 100)))
  scheduleDesktopPersist()
  notifyLedgerChanged()
}

export function loadTheme(): Theme {
  const stored = safeGet(KEYS.theme)
  if (stored === 'light' || stored === 'dark') return stored
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark'
  }
  return 'light'
}

export function saveTheme(theme: Theme): void {
  safeSet(KEYS.theme, theme)
  scheduleDesktopPersist()
}

export function loadPalette(): Palette {
  return normalizePalette(safeGet(KEYS.palette))
}

export function savePalette(palette: Palette): void {
  safeSet(KEYS.palette, palette)
  scheduleDesktopPersist()
}

export function loadFontSize(): FontSize {
  return normalizeFontSize(safeGet(KEYS.fontSize))
}

export function saveFontSize(fontSize: FontSize): void {
  safeSet(KEYS.fontSize, fontSize)
  scheduleDesktopPersist()
}

export function loadCurrency(): Currency {
  return normalizeCurrency(safeGet(KEYS.currency))
}

export function saveCurrency(currency: Currency): void {
  safeSet(KEYS.currency, currency)
  scheduleDesktopPersist()
}

const INDEX_METRIC_KEYS: IndexMetricKey[] = [
  'engel',
  'savings',
  'essential',
  'flexible',
  'emergency',
  'debt',
  'netWorth',
]

function isIndexMetricKey(value: unknown): value is IndexMetricKey {
  return (
    typeof value === 'string' &&
    INDEX_METRIC_KEYS.includes(value as IndexMetricKey)
  )
}

function isGranularity(value: unknown): value is IndexGranularity {
  return value === 'month' || value === 'quarter'
}

const DEFAULT_INDEX_PREFERENCES: IndexPreferences = {
  granularity: 'month',
  hidden: ['debt'],
}

function normalizeIndexPreferences(
  value: unknown,
): IndexPreferences | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>
  if (!isGranularity(record.granularity)) return null
  if (!Array.isArray(record.hidden)) return null
  const hidden = record.hidden.filter(isIndexMetricKey)
  return { granularity: record.granularity, hidden }
}

export function loadIndexPreferences(): IndexPreferences {
  const raw = safeGet(KEYS.indexPrefs)
  if (!raw) return DEFAULT_INDEX_PREFERENCES
  try {
    return (
      normalizeIndexPreferences(JSON.parse(raw)) ??
      DEFAULT_INDEX_PREFERENCES
    )
  } catch {
    return DEFAULT_INDEX_PREFERENCES
  }
}

export function saveIndexPreferences(preferences: IndexPreferences): void {
  safeSet(KEYS.indexPrefs, JSON.stringify(preferences))
  scheduleDesktopPersist()
}

export function loadReminders(): ReminderSettings {
  return readStoredReminders()
}

export function saveReminders(reminders: ReminderSettings): void {
  safeSet(KEYS.reminders, JSON.stringify(reminders))
  scheduleDesktopPersist()
}

export interface ImportedBackup {
  transactions: LedgerTransaction[]
  projects: Project[]
  budgets: BudgetBook | null
  /** null when the backup predates range budgets and the local list should stay. */
  budgetRanges: RangeBudget[] | null
  openingBalance: number | null
  /** null when the backup predates liability export and the local list should stay. */
  liabilities: Liability[] | null
  /** null when the backup predates category export and the local list should stay. */
  categories: Category[] | null
  /** null when the backup predates account export and the local cards stay. */
  accounts: Account[] | null
}

export class ImportError extends Error {}

export function parseBackup(text: string): ImportedBackup {
  let payload: unknown
  try {
    payload = JSON.parse(text)
  } catch {
    throw new ImportError('文件不是有效的 JSON 格式')
  }

  if (!payload || typeof payload !== 'object') {
    throw new ImportError('备份文件内容无法识别')
  }

  const record = payload as Record<string, unknown>
  const rawTransactions = Array.isArray(record.transactions)
    ? record.transactions
    : Array.isArray(record.data)
      ? record.data
      : null

  if (!rawTransactions) {
    throw new ImportError('备份中没有找到流水数据')
  }

  // The backup's own category list takes precedence, so custom categories
  // survive even when restoring on another device. Older backups have none.
  let categories = getActiveCategories()
  let hasCategoryData = false
  if (Array.isArray(record.categories)) {
    const normalizedCategories = normalizeCategories(record.categories)
    if (!normalizedCategories) {
      throw new ImportError('分类数据格式不兼容，请使用账页导出的备份文件')
    }
    categories = withPresetSubcategories(normalizedCategories)
    hasCategoryData = true
  }

  let accounts: Account[] | null = null
  if (record.accounts !== undefined) {
    const normalizedAccounts = normalizeAccounts(record.accounts)
    const rawAccountCount = Array.isArray(record.accounts)
      ? record.accounts.length
      : -1
    if (
      !normalizedAccounts ||
      rawAccountCount < 0 ||
      normalizedAccounts.length !== rawAccountCount
    ) {
      throw new ImportError('账户数据格式不兼容，请使用账页导出的备份文件')
    }
    accounts = normalizedAccounts
  }

  const normalized = rawTransactions
    .map((item, index) =>
      normalizeImportedTransaction(item, index, categories),
    )
    .filter((item): item is LedgerTransaction => item !== null)

  if (normalized.length === 0 && rawTransactions.length > 0) {
    throw new ImportError('流水格式不兼容，请使用账页导出的备份文件')
  }

  const rawProjects = Array.isArray(record.projects) ? record.projects : []
  const projects = rawProjects.filter((item) =>
    isValidProject(item, categories),
  )
  if (projects.length !== rawProjects.length) {
    throw new ImportError('项目数据格式不兼容，请使用账页导出的备份文件')
  }

  let liabilities: Liability[] | null = null
  if (Array.isArray(record.liabilities)) {
    const valid = record.liabilities.filter(isValidLiability)
    if (valid.length !== record.liabilities.length) {
      throw new ImportError('负债数据格式不兼容，请使用账页导出的备份文件')
    }
    liabilities = sortLiabilities(valid)
  }

  let budgets: BudgetBook | null = null
  if (record.budgets !== undefined) {
    const normalizedBudgets = normalizeBudgetBook(record.budgets)
    const rawBudgets =
      record.budgets && typeof record.budgets === 'object'
        ? Object.keys(record.budgets as object).length
        : 0
    if (
      !normalizedBudgets ||
      Object.keys(normalizedBudgets).length !== rawBudgets
    ) {
      throw new ImportError('预算数据格式不兼容，请使用账页导出的备份文件')
    }
    budgets = normalizedBudgets
  } else {
    let legacyCents: number | null = null
    if (
      typeof record.budgetCents === 'number' &&
      Number.isFinite(record.budgetCents) &&
      record.budgetCents > 0
    ) {
      legacyCents = Math.round(record.budgetCents)
    } else if (typeof record.budget === 'number' && record.budget > 0) {
      legacyCents = Math.round(record.budget * 100)
    }
    if (legacyCents !== null) {
      const month = currentMonthKey()
      budgets = {
        [month]: { month, amountCents: legacyCents, dailyMode: 'off' },
      }
    }
  }

  let budgetRanges: RangeBudget[] | null = null
  if (record.budgetRanges !== undefined) {
    const normalizedRanges = normalizeRangeBudgets(record.budgetRanges)
    const rawRanges = Array.isArray(record.budgetRanges)
      ? record.budgetRanges.length
      : -1
    if (
      !normalizedRanges ||
      rawRanges < 0 ||
      normalizedRanges.length !== rawRanges
    ) {
      throw new ImportError('区间预算数据格式不兼容，请使用账页导出的备份文件')
    }
    budgetRanges = normalizedRanges
  }

  let openingBalance: number | null = null
  if (
    typeof record.openingBalanceCents === 'number' &&
    Number.isFinite(record.openingBalanceCents) &&
    record.openingBalanceCents >= 0
  ) {
    openingBalance = record.openingBalanceCents / 100
  } else if (
    typeof record.openingBalance === 'number' &&
    Number.isFinite(record.openingBalance) &&
    record.openingBalance >= 0
  ) {
    openingBalance = record.openingBalance
  }

  return {
    transactions: sortTransactions(normalized),
    projects,
    budgets,
    budgetRanges,
    openingBalance,
    liabilities,
    categories: hasCategoryData ? categories : null,
    accounts,
  }
}

function normalizeImportedTransaction(
  value: unknown,
  index: number,
  categories: Category[],
): LedgerTransaction | null {
  const normalized = normalizeTransaction(value, categories)
  if (normalized) return normalized
  if (!value || typeof value !== 'object') return null

  const item = value as Record<string, unknown>
  // A v2-looking record with broken allocations must not be silently
  // downgraded to a 100% daily split.
  if (
    item.schemaVersion !== undefined ||
    item.amountCents !== undefined ||
    item.allocations !== undefined
  ) {
    return null
  }

  const type =
    item.type === 'income' ? 'income' : item.type === 'expense' ? 'expense' : null
  const amountCents =
    typeof item.amount === 'number'
      ? Math.round(item.amount * 100)
      : typeof item.amount === 'string'
        ? Math.round(Number(item.amount) * 100)
        : NaN

  if (!type || !Number.isInteger(amountCents) || amountCents <= 0) return null

  const date = typeof item.date === 'string' ? item.date : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null

  const categoryId =
    typeof item.categoryId === 'string'
      ? item.categoryId
      : typeof item.category === 'string'
        ? item.category
        : ''

  const accountMap: Record<string, string> = {
    微信: 'wechat',
    支付宝: 'alipay',
    银行卡: 'bank',
    现金: 'cash',
  }
  const accountId =
    typeof item.accountId === 'string' &&
    item.accountId.length > 0 &&
    item.accountId.length <= 80
      ? item.accountId
      : typeof item.account === 'string'
        ? (accountMap[item.account] ?? 'bank')
        : 'bank'

  const fallbackCategory =
    categories.find(
      (category) =>
        category.type === type &&
        category.id ===
          (type === 'expense' ? 'other_expense' : 'other_income'),
    ) ?? categories.find((category) => category.type === type)
  if (!fallbackCategory) return null

  const matchedCategory = categories.find(
    (category) => category.id === categoryId && category.type === type,
  )

  const id =
    typeof item.id === 'string' && item.id.length > 0
      ? item.id
      : `import-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`

  return {
    id,
    schemaVersion: 2,
    type,
    amountCents,
    categoryId: (matchedCategory ?? fallbackCategory).id,
    accountId,
    date,
    note: typeof item.note === 'string' ? item.note : '',
    allocations: [
      makeDailyAllocation(amountCents, `${id}-al-1`, 'migrated'),
    ],
    createdAt:
      typeof item.createdAt === 'string'
        ? item.createdAt
        : new Date().toISOString(),
  }
}
