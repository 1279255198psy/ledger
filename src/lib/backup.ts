import { isDesktopApp } from './desktop'
import { idbDelete, idbGet, idbSet } from './idb'
import {
  readLedgerDataSnapshot,
  validateLedgerDataSnapshot,
} from './storage'
import type { LedgerDataSnapshot } from './sync/types'

/**
 * Local rolling backups. A backup is a complete financial snapshot, stored
 * next to the ledger (desktop) or in IndexedDB (Android). It never travels
 * over sync and is only applied when the user explicitly restores it.
 */

export type BackupReason =
  | 'auto'
  | 'manual'
  | 'before-import'
  | 'before-restore'
  | 'before-clear'
  | 'before-reset'

export interface BackupCounts {
  transactions: number
  projects: number
  liabilities: number
  categories: number
  accounts: number
}

export interface BackupRecord {
  app: '账页'
  backupVersion: 1
  id: string
  createdAt: string
  appVersion: string
  reason: BackupReason
  counts: BackupCounts
  snapshot: LedgerDataSnapshot
}

export interface BackupMeta {
  /** File name on desktop, generated id in IndexedDB. */
  id: string
  createdAt: string
  reason: BackupReason
  bytes: number
  appVersion?: string
  counts?: BackupCounts
}

export interface BackupInspection {
  meta: BackupMeta
  snapshot: LedgerDataSnapshot
  counts: BackupCounts
  firstDate: string | null
  lastDate: string | null
}

export const BACKUP_REASON_LABELS: Record<BackupReason, string> = {
  auto: '自动备份',
  manual: '手动备份',
  'before-import': '导入前',
  'before-restore': '恢复前',
  'before-clear': '清空前',
  'before-reset': '重置前',
}

const IDB_INDEX_KEY = 'backupIndex.v1'
const IDB_RECORD_PREFIX = 'backup.v1:'
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_BACKUPS = 30
const DAILY_KEEP_DAYS = 14

interface BackupIndex {
  v: 1
  items: BackupMeta[]
}

interface DesktopBackupMeta {
  name: string
  createdAtMs: number
  reason: string
  bytes: number
}

let autoInFlight: Promise<BackupMeta | null> | null = null
let backupChain: Promise<unknown> = Promise.resolve()

function appVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'
}

function newBackupId(): string {
  return `b-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function byteSize(value: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(value).length
  }
  return value.length * 2
}

function countsOf(snapshot: LedgerDataSnapshot): BackupCounts {
  return {
    transactions: snapshot.transactions.length,
    projects: snapshot.projects.length,
    liabilities: snapshot.liabilities.length,
    categories: snapshot.categories.length,
    accounts: snapshot.accounts?.length ?? 0,
  }
}

function dateRangeOf(
  snapshot: LedgerDataSnapshot,
): { firstDate: string | null; lastDate: string | null } {
  let firstDate: string | null = null
  let lastDate: string | null = null
  for (const transaction of snapshot.transactions) {
    if (!firstDate || transaction.date < firstDate) firstDate = transaction.date
    if (!lastDate || transaction.date > lastDate) lastDate = transaction.date
  }
  return { firstDate, lastDate }
}

export function hasLedgerContent(snapshot: LedgerDataSnapshot): boolean {
  return (
    snapshot.transactions.length > 0 ||
    snapshot.projects.length > 0 ||
    snapshot.liabilities.length > 0 ||
    snapshot.budgetRanges.length > 0 ||
    Object.keys(snapshot.budgets).length > 0 ||
    snapshot.openingBalanceCents > 0
  )
}

function metaFromRecord(record: BackupRecord): BackupMeta {
  return {
    id: record.id,
    createdAt: record.createdAt,
    reason: record.reason,
    bytes: byteSize(JSON.stringify(record)),
    appVersion: record.appVersion,
    counts: record.counts,
  }
}

function sortNewestFirst(items: BackupMeta[]): BackupMeta[] {
  return [...items].sort(
    (left, right) =>
      Date.parse(right.createdAt) - Date.parse(left.createdAt),
  )
}

async function desktopList(): Promise<BackupMeta[]> {
  const { invoke } = await import('@tauri-apps/api/core')
  const items = await invoke<DesktopBackupMeta[]>('list_ledger_backups')
  return sortNewestFirst(
    items.map((item) => ({
      id: item.name,
      createdAt: new Date(item.createdAtMs).toISOString(),
      reason: item.reason as BackupReason,
      bytes: item.bytes,
    })),
  )
}

async function desktopSave(record: BackupRecord): Promise<BackupMeta> {
  const { invoke } = await import('@tauri-apps/api/core')
  const saved = await invoke<DesktopBackupMeta>('save_ledger_backup', {
    record,
  })
  return {
    id: saved.name,
    createdAt: new Date(saved.createdAtMs).toISOString(),
    reason: record.reason,
    bytes: saved.bytes,
    appVersion: record.appVersion,
    counts: record.counts,
  }
}

async function desktopRead(id: string): Promise<BackupRecord | null> {
  const { invoke } = await import('@tauri-apps/api/core')
  const record = await invoke<BackupRecord | null>('read_ledger_backup', {
    name: id,
  })
  return record ?? null
}

async function desktopDelete(id: string): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('delete_ledger_backup', { name: id })
}

function readIndex(): Promise<BackupIndex> {
  return idbGet<BackupIndex>(IDB_INDEX_KEY).then(
    (index) =>
      index && index.v === 1 && Array.isArray(index.items)
        ? index
        : { v: 1, items: [] },
  )
}

function dayKey(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

/** Keeps recent snapshots plus one per day; returns what falls outside. */
function prunePlan(items: BackupMeta[]): {
  kept: BackupMeta[]
  removed: BackupMeta[]
} {
  const sorted = sortNewestFirst(items)
  const keep = new Set<string>()
  for (const item of sorted.slice(0, MAX_BACKUPS)) keep.add(item.id)

  const days = new Set<string>()
  for (const item of sorted) {
    if (days.size >= DAILY_KEEP_DAYS) break
    const key = dayKey(item.createdAt)
    if (days.has(key)) continue
    days.add(key)
    keep.add(item.id)
  }

  return {
    kept: sorted.filter((item) => keep.has(item.id)),
    removed: sorted.filter((item) => !keep.has(item.id)),
  }
}

async function idbList(): Promise<BackupMeta[]> {
  const index = await readIndex()
  return sortNewestFirst(index.items)
}

async function idbSave(record: BackupRecord): Promise<BackupMeta> {
  const index = await readIndex()
  const meta = metaFromRecord(record)
  const stored = await idbSet(
    `${IDB_RECORD_PREFIX}${record.id}`,
    record,
  )
  if (!stored) {
    throw new Error('无法写入本机备份，请检查可用存储空间')
  }

  const { kept, removed } = prunePlan([meta, ...index.items])
  const indexed = await idbSet(IDB_INDEX_KEY, {
    v: 1 as const,
    items: kept,
  })
  if (!indexed) {
    // Do not leave a record that the index cannot ever find again.
    await idbDelete(`${IDB_RECORD_PREFIX}${record.id}`)
    throw new Error('无法保存备份索引，请检查可用存储空间')
  }
  for (const item of removed) {
    await idbDelete(`${IDB_RECORD_PREFIX}${item.id}`)
  }
  return meta
}

async function idbRead(id: string): Promise<BackupRecord | null> {
  const record = await idbGet<BackupRecord>(`${IDB_RECORD_PREFIX}${id}`)
  return record ?? null
}

async function idbDeleteRecord(id: string): Promise<void> {
  const index = await readIndex()
  const indexed = await idbSet(IDB_INDEX_KEY, {
    v: 1 as const,
    items: index.items.filter((item) => item.id !== id),
  })
  if (!indexed) {
    throw new Error('无法更新备份列表，请稍后重试')
  }
  await idbDelete(`${IDB_RECORD_PREFIX}${id}`)
}

/** Serializes backup writes so two triggers cannot race the index. */
function queue<T>(task: () => Promise<T>): Promise<T> {
  const next = backupChain.catch(() => undefined).then(task)
  backupChain = next
  return next
}

export async function listBackups(): Promise<BackupMeta[]> {
  return isDesktopApp() ? desktopList() : idbList()
}

export function createBackup(
  reason: BackupReason,
  source?: LedgerDataSnapshot,
): Promise<BackupMeta> {
  return queue(async () => {
    const snapshot = source ?? readLedgerDataSnapshot()
    const record: BackupRecord = {
      app: '账页',
      backupVersion: 1,
      id: newBackupId(),
      createdAt: new Date().toISOString(),
      appVersion: appVersion(),
      reason,
      counts: countsOf(snapshot),
      snapshot,
    }

    if (isDesktopApp()) return desktopSave(record)
    return idbSave(record)
  })
}

async function readBackup(id: string): Promise<BackupRecord | null> {
  return isDesktopApp() ? desktopRead(id) : idbRead(id)
}

/**
 * Reads and validates a backup without changing the current ledger. This is
 * the "rehearsal": the UI can show what the file contains and prove that it
 * parses before the user commits to replacing anything.
 */
export async function inspectBackup(id: string): Promise<BackupInspection> {
  const record = await readBackup(id)
  if (!record) throw new Error('备份不存在或已经损坏')
  if (record.app !== '账页' || record.backupVersion !== 1) {
    throw new Error('无法识别的备份格式')
  }

  const snapshot = validateLedgerDataSnapshot(record.snapshot, {
    sourceLabel: '备份',
  })
  const range = dateRangeOf(snapshot)
  return {
    meta: { ...metaFromRecord(record), id },
    snapshot,
    counts: countsOf(snapshot),
    ...range,
  }
}

export async function deleteBackup(id: string): Promise<void> {
  await queue(async () => {
    if (isDesktopApp()) await desktopDelete(id)
    else await idbDeleteRecord(id)
  })
}

/**
 * Creates at most one automatic backup per day, and only when there is
 * something worth protecting. Failures are the caller's to log; an automatic
 * backup should never interrupt bookkeeping.
 */
export function maybeCreateAutoBackup(): Promise<BackupMeta | null> {
  if (autoInFlight) return autoInFlight

  autoInFlight = (async () => {
    const snapshot = readLedgerDataSnapshot()
    if (!hasLedgerContent(snapshot)) return null

    const backups = await listBackups()
    const newest = backups[0]
    if (newest && Date.now() - Date.parse(newest.createdAt) < DAY_MS) {
      return null
    }
    return createBackup('auto', snapshot)
  })().finally(() => {
    autoInFlight = null
  })

  return autoInFlight
}
