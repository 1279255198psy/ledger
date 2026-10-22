import type {
  Currency,
  FontSize,
  LedgerTransaction,
  Palette,
  Project,
  Theme,
} from '../types'
import {
  isValidProject,
  migrateV1Transaction,
  normalizeTransaction,
  sortTransactions,
} from './data'
import { makeDailyAllocation } from './allocations'
import { isCurrency, normalizeCurrency } from './currency'
import { normalizeFontSize } from './fontSize'
import { isPalette, normalizePalette } from './themes'
import {
  isDesktopApp,
  loadDesktopLedger,
  saveDesktopLedger,
} from './desktop'

const KEYS = {
  transactions: 'zhangye.transactions.v2',
  transactionsV1: 'zhangye.transactions.v1',
  projects: 'zhangye.projects.v1',
  budget: 'zhangye.budget.v2',
  budgetV1: 'zhangye.budget.v1',
  theme: 'zhangye.theme.v1',
  palette: 'zhangye.palette.v1',
  fontSize: 'zhangye.fontSize.v1',
  currency: 'zhangye.currency.v1',
  seeded: 'zhangye.seeded.v1',
  updatedAt: 'zhangye.updatedAt.v1',
} as const

export const DEFAULT_BUDGET = 8000

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
  projects: Project[]
  transactions: LedgerTransaction[]
  budgetCents: number
  theme: Theme
  palette: Palette
  fontSize: FontSize
  currency: Currency
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

function readStoredTransactions(): TransactionReadResult {
  const rawV2 = safeGet(KEYS.transactions)
  if (rawV2 !== null) {
    try {
      const parsed: unknown = JSON.parse(rawV2)
      if (Array.isArray(parsed)) {
        const normalized = parsed.map(normalizeTransaction)
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
        const migrated = parsed.map(migrateV1Transaction)
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

function readStoredProjects(): Project[] {
  const raw = safeGet(KEYS.projects)
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (Array.isArray(parsed) && parsed.every(isValidProject)) {
      return parsed
    }
  } catch {
    // An invalid project list should not take the ledger down with it.
  }
  return []
}

function readBudgetCents(): number {
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

  return Math.round(DEFAULT_BUDGET * 100)
}

function applyDesktopSnapshot(snapshot: Record<string, unknown>): void {
  if (Array.isArray(snapshot.transactions)) {
    const normalized = snapshot.transactions.map(normalizeTransaction)
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
    const projects = snapshot.projects.filter(isValidProject)
    if (projects.length === snapshot.projects.length) {
      safeSet(KEYS.projects, JSON.stringify(projects))
    }
  }

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
    safeSet(KEYS.budget, String(Math.round(budgetCents)))
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
  if (typeof snapshot.seeded === 'boolean') {
    safeSet(KEYS.seeded, String(snapshot.seeded))
  }
  if (typeof snapshot.updatedAt === 'string') {
    safeSet(KEYS.updatedAt, snapshot.updatedAt)
  }
}

function readDesktopSnapshot(): DesktopLedgerSnapshot {
  const { transactions } = readStoredTransactions()
  const storedTheme = safeGet(KEYS.theme)
  const storedPalette = safeGet(KEYS.palette)

  return {
    app: '账页',
    version: 2,
    updatedAt: safeGet(KEYS.updatedAt) ?? new Date().toISOString(),
    projects: readStoredProjects(),
    transactions,
    budgetCents: readBudgetCents(),
    theme: storedTheme === 'dark' ? 'dark' : 'light',
    palette: normalizePalette(storedPalette),
    fontSize: normalizeFontSize(safeGet(KEYS.fontSize)),
    currency: normalizeCurrency(safeGet(KEYS.currency)),
    seeded: safeGet(KEYS.seeded) === 'true',
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
}

export function loadProjects(): Project[] {
  return readStoredProjects()
}

export function saveProjects(projects: Project[]): void {
  safeSet(KEYS.projects, JSON.stringify(projects))
  scheduleDesktopPersist()
}

export function loadBudget(): number {
  return readBudgetCents() / 100
}

export function saveBudget(budget: number): void {
  safeSet(KEYS.budget, String(Math.round(budget * 100)))
  scheduleDesktopPersist()
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

export interface ImportedBackup {
  transactions: LedgerTransaction[]
  projects: Project[]
  budget: number | null
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

  const normalized = rawTransactions
    .map((item, index) => normalizeImportedTransaction(item, index))
    .filter((item): item is LedgerTransaction => item !== null)

  if (normalized.length === 0 && rawTransactions.length > 0) {
    throw new ImportError('流水格式不兼容，请使用账页导出的备份文件')
  }

  const rawProjects = Array.isArray(record.projects) ? record.projects : []
  const projects = rawProjects.filter(isValidProject)
  if (projects.length !== rawProjects.length) {
    throw new ImportError('项目数据格式不兼容，请使用账页导出的备份文件')
  }

  let budget: number | null = null
  if (
    typeof record.budgetCents === 'number' &&
    Number.isFinite(record.budgetCents) &&
    record.budgetCents > 0
  ) {
    budget = record.budgetCents / 100
  } else if (typeof record.budget === 'number' && record.budget > 0) {
    budget = record.budget
  }

  return {
    transactions: sortTransactions(normalized),
    projects,
    budget,
  }
}

function normalizeImportedTransaction(
  value: unknown,
  index: number,
): LedgerTransaction | null {
  const normalized = normalizeTransaction(value)
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
  const knownAccountIds = ['wechat', 'alipay', 'bank', 'cash']
  const accountId =
    typeof item.accountId === 'string' &&
    knownAccountIds.includes(item.accountId)
      ? item.accountId
      : typeof item.account === 'string'
        ? (accountMap[item.account] ?? 'bank')
        : 'bank'

  const knownCategory =
    type === 'expense'
      ? [
          'food',
          'transport',
          'shopping',
          'housing',
          'entertainment',
          'medical',
          'education',
          'other_expense',
        ]
      : ['salary', 'bonus', 'investment', 'freelance', 'gift', 'other_income']

  const id =
    typeof item.id === 'string' && item.id.length > 0
      ? item.id
      : `import-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`

  return {
    id,
    schemaVersion: 2,
    type,
    amountCents,
    categoryId: knownCategory.includes(categoryId)
      ? categoryId
      : type === 'expense'
        ? 'other_expense'
        : 'other_income',
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
