import { idbAvailable, idbDelete, idbGet, idbSet } from './idb'
import { reportStorageError } from './storageEvents'

/**
 * The ledger's bulky records (transactions, the sync merge base and the
 * notification inbox) live here. localStorage stays the entry point while the
 * app boots and remains the fallback when IndexedDB is unavailable, but its
 * five megabyte ceiling is no longer part of the long-term picture.
 *
 * Reads stay synchronous: everything is hydrated into memory before React
 * mounts, and writes update that cache first. Only persistence is asynchronous.
 */

export type BulkKey = 'transactions' | 'syncBase' | 'captureInbox'

const BULK_KEYS: BulkKey[] = ['transactions', 'syncBase', 'captureInbox']

const LEGACY_KEYS: Record<BulkKey, string> = {
  transactions: 'zhangye.transactions.v2',
  syncBase: 'zhangye.sync.base.v1',
  captureInbox: 'zhangye.captureInbox.v1',
}

/** Pre-v2 transaction array, removed once the current mirror is confirmed. */
const LEGACY_TRANSACTIONS_V1 = 'zhangye.transactions.v1'
const FALLBACK_META_KEY = 'zhangye.bulk.fallbackAt.v1'
const RECOVERY_KEY = 'zhangye.bulk.recovery.v1'
const FLUSH_DELAY_MS = 30

type Backend = 'indexeddb' | 'localStorage'

interface BulkRecord {
  v: string
  t: number
}

interface RecoveryJournal {
  savedAt: number
  values: Partial<Record<BulkKey, string>>
}

const cache = new Map<BulkKey, string>()
const known = new Set<BulkKey>()
const idbSavedAt = new Map<BulkKey, number>()
const fallbackAt = new Map<BulkKey, number>()
const pending = new Map<BulkKey, string>()

let backend: Backend = 'localStorage'
let hydrated = false
let hydration: Promise<void> | null = null
let flushTimer: number | null = null
let writeChain: Promise<void> = Promise.resolve()
let hooksInstalled = false
let journalPendingClear = false
let degraded = false

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value)
    return true
  } catch (error) {
    reportStorageError(error)
    return false
  }
}

function safeRemove(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // A failed removal only leaves a stale duplicate behind.
  }
}

function readFallbackMeta(): Partial<Record<BulkKey, number>> {
  const raw = safeGet(FALLBACK_META_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const meta: Partial<Record<BulkKey, number>> = {}
    for (const key of BULK_KEYS) {
      const value = parsed[key]
      if (typeof value === 'number' && Number.isFinite(value)) {
        meta[key] = value
      }
    }
    return meta
  } catch {
    return {}
  }
}

function writeFallbackAt(key: BulkKey, at: number): void {
  const meta = readFallbackMeta()
  meta[key] = at
  safeSet(FALLBACK_META_KEY, JSON.stringify(meta))
  fallbackAt.set(key, at)
}

function clearFallbackAt(key: BulkKey): void {
  fallbackAt.delete(key)
  const meta = readFallbackMeta()
  if (meta[key] === undefined) return
  delete meta[key]
  if (Object.keys(meta).length === 0) safeRemove(FALLBACK_META_KEY)
  else safeSet(FALLBACK_META_KEY, JSON.stringify(meta))
}

function writeFallback(key: BulkKey, value: string): void {
  if (typeof window === 'undefined') return
  if (safeSet(LEGACY_KEYS[key], value)) {
    writeFallbackAt(key, Date.now())
  }
}

/** Removes the localStorage copy once IndexedDB holds the same or newer data. */
function clearLegacy(key: BulkKey): void {
  safeRemove(LEGACY_KEYS[key])
  clearFallbackAt(key)
}

function scheduleFlush(): void {
  if (typeof window === 'undefined') {
    void flushBulkStorage()
    return
  }
  if (flushTimer !== null) return
  flushTimer = window.setTimeout(() => {
    flushTimer = null
    void flushBulkStorage()
  }, FLUSH_DELAY_MS)
}

function journalPendingWrites(): void {
  if (pending.size === 0 || typeof window === 'undefined') return
  const values: Partial<Record<BulkKey, string>> = {}
  for (const [key, value] of pending) values[key] = value
  const journal: RecoveryJournal = { savedAt: Date.now(), values }
  try {
    window.localStorage.setItem(RECOVERY_KEY, JSON.stringify(journal))
    journalPendingClear = true
  } catch {
    // The journal is a best-effort copy for a closing tab; a full localStorage
    // must not raise a "your ledger is full" warning when IndexedDB is fine.
  }
}

function installLifecycleHooks(): void {
  if (hooksInstalled || typeof window === 'undefined') return
  hooksInstalled = true

  const flushBeforeHide = () => {
    journalPendingWrites()
    void flushBulkStorage()
  }
  window.addEventListener('pagehide', flushBeforeHide)
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flushBeforeHide()
    })
  }
}

function arrayLength(raw: string): number | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.length : null
  } catch {
    return null
  }
}

/**
 * IndexedDB is "best effort" by default: a browser under disk pressure may
 * evict it. Asking for persistent storage makes the ledger a poor eviction
 * candidate. This is only a hint — a refusal changes nothing.
 */
function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.().catch(() => undefined)
  } catch {
    // Older WebViews may not implement the API at all.
  }
}

function applyHydratedValue(
  key: BulkKey,
  value: string,
  savedAt: number,
): void {
  // A leftover localStorage copy can be older than what IndexedDB already
  // holds (a failed removal, or a journal that was already flushed). Ignoring
  // it here keeps the stale copy from overwriting newer data in memory.
  //
  // A copy from before this feature shipped has no recorded time at all. That
  // unknown time is treated as "prefer it": in a real upgrade IndexedDB is
  // empty at that point, and dropping it would strand the user's ledger.
  const storedAt = Math.max(idbSavedAt.get(key) ?? -1, fallbackAt.get(key) ?? -1)
  if (savedAt > 0 && savedAt < storedAt) return

  // A build from before the migration has no timestamp either. If it wrote an
  // empty ledger over a populated IndexedDB copy, keep the populated one.
  if (savedAt === 0 && key === 'transactions') {
    const previous = cache.get(key)
    if (previous !== undefined && previous !== value) {
      const previousCount = arrayLength(previous)
      const nextCount = arrayLength(value)
      if (previousCount !== null && previousCount > 0 && nextCount === 0) {
        return
      }
    }
  }

  cache.set(key, value)
  known.add(key)

  // Unequal values with equal or unknown timestamps are treated as the
  // localStorage copy winning, then written back so the two copies converge.
  if (backend === 'indexeddb') {
    pending.set(key, value)
  }
}

export function hydrateBulkStorage(): Promise<void> {
  if (hydration) return hydration

  hydration = (async () => {
    if (typeof window === 'undefined') {
      hydrated = true
      return
    }

    const available = await idbAvailable()
    backend = available ? 'indexeddb' : 'localStorage'

    const fallbackMeta = readFallbackMeta()
    for (const key of BULK_KEYS) {
      const at = fallbackMeta[key]
      if (typeof at === 'number') fallbackAt.set(key, at)
    }

    if (backend === 'indexeddb') {
      requestPersistentStorage()
      for (const key of BULK_KEYS) {
        const record = await idbGet<BulkRecord>(key)
        if (record && typeof record.v === 'string') {
          cache.set(key, record.v)
          known.add(key)
          idbSavedAt.set(
            key,
            typeof record.t === 'number' ? record.t : 0,
          )
        }
      }
    }

    // A localStorage copy can be newer than IndexedDB after a degraded write
    // (or on the very first launch after this feature shipped).
    for (const key of BULK_KEYS) {
      const legacy = safeGet(LEGACY_KEYS[key])
      if (legacy === null) continue
      const legacyAt = fallbackMeta[key] ?? 0
      applyHydratedValue(key, legacy, legacyAt)
    }

    // The recovery journal is written on pagehide while a write is in flight.
    const rawJournal = safeGet(RECOVERY_KEY)
    if (rawJournal) {
      try {
        const journal = JSON.parse(rawJournal) as RecoveryJournal
        if (journal && typeof journal.savedAt === 'number') {
          for (const key of BULK_KEYS) {
            const value = journal.values?.[key]
            if (typeof value === 'string') {
              applyHydratedValue(key, value, journal.savedAt)
            }
          }
          journalPendingClear = true
        }
      } catch {
        // A malformed journal is ignored and replaced by the next write.
      }
    }

    hydrated = true
    installLifecycleHooks()
    if (backend === 'indexeddb' && pending.size > 0) scheduleFlush()
  })().catch((error) => {
    hydrated = true
    console.error('初始化本地大容量存储失败', error)
  })

  return hydration
}

export function bulkRead(key: BulkKey): string | null {
  const value = cache.get(key)
  if (value !== undefined) return value
  if (known.has(key)) return null

  if (typeof window !== 'undefined') {
    const legacy = safeGet(LEGACY_KEYS[key])
    if (legacy !== null) {
      cache.set(key, legacy)
      known.add(key)
      return legacy
    }
  }
  return null
}

export function bulkWrite(key: BulkKey, value: string): void {
  cache.set(key, value)
  known.add(key)

  if (backend === 'indexeddb' && !degraded) {
    pending.set(key, value)
    scheduleFlush()
    return
  }
  writeFallback(key, value)
}

export function bulkRemove(key: BulkKey): Promise<void> {
  cache.delete(key)
  known.delete(key)
  pending.delete(key)

  if (backend === 'indexeddb' && !degraded) {
    writeChain = writeChain
      .catch(() => undefined)
      .then(async () => {
        const ok = await idbDelete(key)
        if (ok) {
          idbSavedAt.delete(key)
          clearLegacy(key)
        } else {
          safeRemove(LEGACY_KEYS[key])
          clearFallbackAt(key)
        }
      })
    return writeChain
  }
  safeRemove(LEGACY_KEYS[key])
  clearFallbackAt(key)
  return Promise.resolve()
}

export function flushBulkStorage(): Promise<void> {
  if (typeof window !== 'undefined' && flushTimer !== null) {
    window.clearTimeout(flushTimer)
    flushTimer = null
  }

  writeChain = writeChain
    .catch(() => undefined)
    .then(async () => {
      if (backend !== 'indexeddb' || degraded) {
        for (const [key, value] of pending) writeFallback(key, value)
        pending.clear()
        if (journalPendingClear) {
          safeRemove(RECOVERY_KEY)
          journalPendingClear = false
        }
        return
      }

      while (pending.size > 0) {
        const entries = [...pending.entries()]
        // Do not drop a newer value that arrived while this batch was queued.
        for (const [key, value] of entries) {
          if (pending.get(key) === value) pending.delete(key)
        }

        for (const [key, value] of entries) {
          const savedAt = Date.now()
          const ok = await idbSet(key, { v: value, t: savedAt })
          if (ok) {
            idbSavedAt.set(key, savedAt)
            clearLegacy(key)
          } else {
            degraded = true
            writeFallback(key, value)
            reportStorageError(new Error('IndexedDB write failed'))
          }
        }
      }

      if (journalPendingClear && pending.size === 0) {
        safeRemove(RECOVERY_KEY)
        journalPendingClear = false
      } else if (pending.size > 0) {
        scheduleFlush()
      }
    })

  return writeChain
}

/**
 * Called once after the desktop mirror has been applied. Everything that came
 * from localStorage is confirmed in IndexedDB before the old keys are dropped.
 */
export async function migrateLegacyBulkStorage(): Promise<void> {
  if (!hydrated) await hydrateBulkStorage()
  if (backend !== 'indexeddb') {
    if (hydrated && pending.size > 0) await flushBulkStorage()
    return
  }

  await flushBulkStorage()

  for (const key of BULK_KEYS) {
    if (!known.has(key)) continue
    const value = cache.get(key)
    if (value === undefined) continue

    if (!idbSavedAt.has(key)) {
      const savedAt = Date.now()
      const ok = await idbSet(key, { v: value, t: savedAt })
      if (!ok) continue
      idbSavedAt.set(key, savedAt)
    }
    clearLegacy(key)
  }

  // The v1 array is only removed once the v2 mirror is safely in IndexedDB
  // (or was already present); otherwise the normal v1 -> v2 migration keeps it.
  if (known.has('transactions')) safeRemove(LEGACY_TRANSACTIONS_V1)
}

export function bulkBackend(): Backend {
  return backend
}

export function bulkIsHydrated(): boolean {
  return hydrated
}

/** Small diagnostic snapshot for the settings screen. */
export function bulkStorageInfo(): {
  backend: Backend
  pending: number
  keys: BulkKey[]
} {
  return {
    backend,
    pending: pending.size,
    keys: [...known],
  }
}
