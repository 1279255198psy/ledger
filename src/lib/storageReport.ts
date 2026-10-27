import { bulkBackend, bulkRead } from './bulkStore'

/**
 * Read-only view of where the ledger's bytes live, used by the settings
 * screen. It reads the in-memory bulk cache, so opening it never parses the
 * whole ledger twice or touches the network.
 */

export interface StorageUsageEntry {
  key: string
  label: string
  bytes: number
  count?: number
  unit?: string
}

export interface StorageReport {
  backend: 'indexeddb' | 'localStorage'
  entries: StorageUsageEntry[]
  totalBytes: number
  transactionCount: number
  sampleDays: number
  bytesPerYear: number | null
  quotaBytes: number | null
  usageBytes: number | null
  yearsLeft: number | null
}

const LOCAL_STORAGE_QUOTA = 5 * 1024 * 1024
const BYTE_UNITS = ['B', 'KB', 'MB', 'GB']

const INBOX_KEYS = new Set([
  'zhangye.transactions.v2',
  'zhangye.transactions.v1',
  'zhangye.sync.base.v1',
  'zhangye.captureInbox.v1',
  'zhangye.bulk.recovery.v1',
  'zhangye.bulk.fallbackAt.v1',
])

function byteSize(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length
  }
  return value.length * 2
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${BYTE_UNITS[unit]}`
}

function parseArray(raw: string | null): unknown[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function localSettingsBytes(): number {
  if (typeof window === 'undefined') return 0
  let total = 0
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key || INBOX_KEYS.has(key)) continue
      total += byteSize(key) + byteSize(window.localStorage.getItem(key) ?? '')
    }
  } catch {
    return total
  }
  return total
}

function transactionGrowth(
  raw: string | null,
  transactions: unknown[],
): { days: number; bytesPerYear: number | null } {
  if (!raw || transactions.length < 20) {
    return { days: 0, bytesPerYear: null }
  }

  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY
  for (const item of transactions) {
    if (!item || typeof item !== 'object') continue
    const date = (item as { date?: unknown }).date
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      continue
    }
    const stamp = Date.parse(`${date}T00:00:00`)
    if (!Number.isFinite(stamp)) continue
    if (stamp < min) min = stamp
    if (stamp > max) max = stamp
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return { days: 0, bytesPerYear: null }
  }

  const days = Math.max(1, Math.round((max - min) / 86_400_000))
  const perRecord = byteSize(raw) / transactions.length
  const bytesPerYear = (perRecord * transactions.length * 365) / days
  return { days, bytesPerYear }
}

async function estimateSpace(): Promise<{
  usage: number | null
  quota: number | null
}> {
  try {
    const estimate = await navigator.storage?.estimate?.()
    return {
      usage:
        typeof estimate?.usage === 'number' ? estimate.usage : null,
      quota:
        typeof estimate?.quota === 'number' ? estimate.quota : null,
    }
  } catch {
    return { usage: null, quota: null }
  }
}

export async function getStorageReport(): Promise<StorageReport> {
  const transactionsRaw = bulkRead('transactions')
  const syncBaseRaw = bulkRead('syncBase')
  const inboxRaw = bulkRead('captureInbox')

  const transactions = parseArray(transactionsRaw)
  const inbox = parseArray(inboxRaw)
  const backend = bulkBackend()

  const transactionBytes = byteSize(transactionsRaw ?? '')
  const syncBaseBytes = byteSize(syncBaseRaw ?? '')
  const inboxBytes = byteSize(inboxRaw ?? '')
  const settingsBytes = localSettingsBytes()

  const entries: StorageUsageEntry[] = [
    {
      key: 'transactions',
      label: '流水',
      bytes: transactionBytes,
      count: transactions.length,
      unit: '笔',
    },
    {
      key: 'syncBase',
      label: '同步基线',
      bytes: syncBaseBytes,
    },
    {
      key: 'captureInbox',
      label: '通知队列',
      bytes: inboxBytes,
      count: inbox.length,
      unit: '条',
    },
    {
      key: 'settings',
      label: '设置与偏好',
      bytes: settingsBytes,
    },
  ]

  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0)
  const growth = transactionGrowth(transactionsRaw, transactions)
  // With sync enabled the merge base mirrors the transactions, so the ledger
  // grows about twice as fast on disk.
  const bytesPerYear =
    growth.bytesPerYear === null
      ? null
      : growth.bytesPerYear * (syncBaseRaw ? 2 : 1)

  const space = await estimateSpace()
  const quotaBytes =
    backend === 'localStorage'
      ? LOCAL_STORAGE_QUOTA
      : (space.quota ?? null)
  const usageBytes = space.usage ?? totalBytes

  const yearsLeft =
    bytesPerYear !== null &&
    bytesPerYear > 0 &&
    quotaBytes !== null &&
    usageBytes !== null
      ? Math.max(0, (quotaBytes - usageBytes) / bytesPerYear)
      : null

  return {
    backend,
    entries,
    totalBytes,
    transactionCount: transactions.length,
    sampleDays: growth.days,
    bytesPerYear,
    quotaBytes,
    usageBytes,
    yearsLeft,
  }
}
