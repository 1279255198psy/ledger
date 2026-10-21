import type { LedgerTransaction, Palette, Theme } from '../types'
import {
  isValidTransaction,
  sortTransactions,
} from './data'
import { DEFAULT_PALETTE, isPalette } from './themes'
import {
  isDesktopApp,
  loadDesktopLedger,
  saveDesktopLedger,
} from './desktop'

const KEYS = {
  transactions: 'zhangye.transactions.v1',
  budget: 'zhangye.budget.v1',
  theme: 'zhangye.theme.v1',
  palette: 'zhangye.palette.v1',
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
  version: number
  updatedAt: string
  transactions: LedgerTransaction[]
  budget: number
  theme: Theme
  palette: Palette
  seeded: boolean
}

let desktopHydrated = false
let persistTimer: number | null = null
let persistChain: Promise<void> = Promise.resolve()
let flushHooksInstalled = false

function applyDesktopSnapshot(snapshot: Record<string, unknown>): void {
  if (
    Array.isArray(snapshot.transactions) &&
    snapshot.transactions.every(isValidTransaction)
  ) {
    safeSet(
      KEYS.transactions,
      JSON.stringify(sortTransactions(snapshot.transactions)),
    )
  }
  if (
    typeof snapshot.budget === 'number' &&
    Number.isFinite(snapshot.budget) &&
    snapshot.budget > 0
  ) {
    safeSet(KEYS.budget, String(snapshot.budget))
  }
  if (snapshot.theme === 'light' || snapshot.theme === 'dark') {
    safeSet(KEYS.theme, snapshot.theme)
  }
  if (isPalette(snapshot.palette)) {
    safeSet(KEYS.palette, snapshot.palette)
  }
  if (typeof snapshot.seeded === 'boolean') {
    safeSet(KEYS.seeded, String(snapshot.seeded))
  }
  if (typeof snapshot.updatedAt === 'string') {
    safeSet(KEYS.updatedAt, snapshot.updatedAt)
  }
}

function readDesktopSnapshot(): DesktopLedgerSnapshot {
  let transactions: LedgerTransaction[] = []
  const rawTransactions = safeGet(KEYS.transactions)
  if (rawTransactions) {
    try {
      const parsed: unknown = JSON.parse(rawTransactions)
      if (Array.isArray(parsed)) {
        transactions = parsed.filter(isValidTransaction)
      }
    } catch {
      // Persist an empty ledger rather than invalid data.
    }
  }

  const storedBudget = Number(safeGet(KEYS.budget))
  const storedTheme = safeGet(KEYS.theme)
  const storedPalette = safeGet(KEYS.palette)

  return {
    app: '账页',
    version: 1,
    updatedAt: safeGet(KEYS.updatedAt) ?? new Date().toISOString(),
    transactions,
    budget:
      Number.isFinite(storedBudget) && storedBudget > 0
        ? storedBudget
        : DEFAULT_BUDGET,
    theme: storedTheme === 'dark' ? 'dark' : 'light',
    palette: isPalette(storedPalette) ? storedPalette : DEFAULT_PALETTE,
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
  const raw = safeGet(KEYS.transactions)
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw)
      if (Array.isArray(parsed) && parsed.every(isValidTransaction)) {
        return sortTransactions(parsed)
      }
    } catch {
      // Fall through and recover with a fresh ledger.
    }
  }

  // A fresh ledger starts blank. The demo ledger is an explicit choice made
  // from the empty state, so a new install never displays invented records.
  safeSet(KEYS.seeded, 'true')
  return []
}

export function saveTransactions(transactions: LedgerTransaction[]): void {
  safeSet(KEYS.transactions, JSON.stringify(transactions))
  safeSet(KEYS.seeded, 'true')
  scheduleDesktopPersist()
}

export function loadBudget(): number {
  const raw = safeGet(KEYS.budget)
  if (!raw) return DEFAULT_BUDGET
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BUDGET
}

export function saveBudget(budget: number): void {
  safeSet(KEYS.budget, String(budget))
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
  const stored = safeGet(KEYS.palette)
  return isPalette(stored) ? stored : DEFAULT_PALETTE
}

export function savePalette(palette: Palette): void {
  safeSet(KEYS.palette, palette)
  scheduleDesktopPersist()
}

export interface ImportedBackup {
  transactions: LedgerTransaction[]
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

  let budget: number | null = null
  if (typeof record.budget === 'number' && record.budget > 0) {
    budget = record.budget
  }

  return { transactions: sortTransactions(normalized), budget }
}

function normalizeImportedTransaction(
  value: unknown,
  index: number,
): LedgerTransaction | null {
  if (isValidTransaction(value)) return value
  if (!value || typeof value !== 'object') return null

  const item = value as Record<string, unknown>
  const type =
    item.type === 'income' ? 'income' : item.type === 'expense' ? 'expense' : null
  const amount =
    typeof item.amount === 'number'
      ? item.amount
      : typeof item.amount === 'string'
        ? Number(item.amount)
        : NaN

  if (!type || !Number.isFinite(amount) || amount <= 0) return null
  if (typeof item.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(item.date)) {
    return null
  }

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

  return {
    id:
      typeof item.id === 'string'
        ? item.id
        : `import-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    type,
    amount,
    categoryId: knownCategory.includes(categoryId)
      ? categoryId
      : type === 'expense'
        ? 'other_expense'
        : 'other_income',
    accountId,
    date: item.date,
    note: typeof item.note === 'string' ? item.note : '',
    createdAt:
      typeof item.createdAt === 'string'
        ? item.createdAt
        : new Date().toISOString(),
  }
}
