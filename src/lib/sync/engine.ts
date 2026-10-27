import { isDesktopApp } from '../desktop'
import { isMobileApp } from '../platform'
import {
  applyLedgerDataSnapshot,
  onLedgerChanged,
  readLedgerDataSnapshot,
} from '../storage'
import { bulkRead, bulkRemove, bulkWrite } from '../bulkStore'
import {
  decryptPayload,
  deriveSyncKey,
  deriveSyncToken,
  encryptPayload,
  formatSyncCode,
  generateDeviceId,
  generatePairingId,
  generateSyncCode,
  isValidSyncCode,
  normalizeSyncCode,
  parseSyncEnvelope,
} from './crypto'
import {
  mergeSnapshots,
  snapshotsEqual,
  type MergeOptions,
} from './merge'
import {
  fetchSyncBlob,
  fetchSyncInfo,
  normalizeSyncUrl,
  pushSyncBlob,
  SyncHttpError,
} from './transport'
import type {
  LedgerDataSnapshot,
  SyncConfig,
  SyncFavor,
  SyncPayload,
  SyncPriority,
  SyncRole,
  SyncUiState,
} from './types'

const CONFIG_KEY = 'zhangye.sync.config.v1'
const META_KEY = 'zhangye.sync.meta.v1'
const RELOAD_EVENT = 'zhangye:ledger-reloaded'

const MOBILE_CHANGE_DELAY = 2000
const DESKTOP_CHANGE_DELAY = 1500
const MOBILE_POLL_INTERVAL = 8000
const DESKTOP_STATUS_INTERVAL = 15000
const REPLY_DELAY = 400

type DirectionChoice = 'merge' | 'local' | 'remote'
type SyncTrigger = 'startup' | 'manual' | 'resume' | 'change' | 'poll'

interface PriorityAnswer {
  choice: SyncFavor
  remember: boolean
}

interface SyncMeta {
  seq: number
  lastDesktopSeq: number
  lastMobileSeq: number
  lastSyncAt: string | null
}

interface DesktopServerStatus {
  running: boolean
  port: number | null
  addresses: string[]
  blobEtag: string | null
  blobSize: number
  lastPeerAt: string | null
  hasData: boolean
}

interface BlobRead {
  contents: string
  etag: string
}

const defaultMeta = (): SyncMeta => ({
  seq: 0,
  lastDesktopSeq: 0,
  lastMobileSeq: 0,
  lastSyncAt: null,
})

const runtimeRole: SyncRole = isDesktopApp() ? 'desktop' : 'mobile'
const syncSupported = isDesktopApp() || isMobileApp()

let config: SyncConfig | null = null
let meta: SyncMeta = defaultMeta()
let base: LedgerDataSnapshot | null = null

let initialized = false
let syncing = false
let syncAgain = false
let directionResolver: ((choice: DirectionChoice | 'cancel') => void) | null = null
let priorityResolver: ((answer: PriorityAnswer | 'cancel') => void) | null = null
let desktopUnlisten: (() => void) | null = null
let desktopStatusTimer: number | null = null
let changeUnsubscribe: (() => void) | null = null
let mobileChangeTimer: number | null = null
let mobilePollTimer: number | null = null
let desktopChangeTimer: number | null = null
let incomingChain: Promise<void> = Promise.resolve()
let applyingSyncedData = false
/** One-off choice for the connection being made; overrides the stored default. */
let sessionPriority: SyncFavor | null = null
let quietSync = false
let syncApplied = false
/** Set while a modal is open, so a background poll cannot close an entry. */
let syncSuspended = false

const listeners = new Set<() => void>()

let ui: SyncUiState = {
  ready: false,
  role: runtimeRole,
  enabled: false,
  phase: syncSupported ? 'idle' : 'disabled',
  message: syncSupported ? '' : '双端同步仅在电脑版和手机版中可用',
  lastSyncAt: null,
  lastError: null,
  conflictCount: 0,
  running: false,
  port: null,
  addresses: [],
  code: null,
  lastPeerAt: null,
  url: null,
  auto: true,
  hasBase: false,
  pendingDirection: null,
  pendingPriority: false,
  priority: 'ask',
}

export function getSyncState(): SyncUiState {
  return ui
}

/** Automatic syncs pause while the user is filling in a form. */
export function setSyncSuspended(suspended: boolean): void {
  const wasSuspended = syncSuspended
  syncSuspended = suspended
  if (wasSuspended && !suspended && config?.enabled) {
    if (runtimeRole === 'desktop') {
      // Finish a push that arrived while the desktop form was open.
      void queueIncomingBlob()
    } else if (config.auto) {
      void runMobileSync('resume')
    }
  }
}

export function subscribeSync(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(patch: Partial<SyncUiState>): void {
  ui = { ...ui, ...patch }
  for (const listener of listeners) {
    try {
      listener()
    } catch (error) {
      console.error('同步状态监听失败', error)
    }
  }
}

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? null : (JSON.parse(raw) as T)
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Synchronization keeps working for this session without persistence.
  }
}

function saveConfig(): void {
  if (config) writeJson(CONFIG_KEY, config)
}

function persistMeta(): void {
  writeJson(META_KEY, meta)
}

/** The merge base is a full snapshot, so it lives with the other bulk data. */
function readBase(): LedgerDataSnapshot | null {
  const raw = bulkRead('syncBase')
  if (raw === null) return null
  try {
    return JSON.parse(raw) as LedgerDataSnapshot
  } catch {
    return null
  }
}

function saveBase(snapshot: LedgerDataSnapshot | null): void {
  base = snapshot
  if (snapshot) bulkWrite('syncBase', JSON.stringify(snapshot))
  else void bulkRemove('syncBase')
  emit({ hasBase: snapshot !== null })
}

/**
 * A restore replaces the whole ledger outside the sync flow. Treating the
 * restored snapshot as the new merge base keeps the deliberate rollback from
 * being read as a batch of deletions the next time sync runs.
 */
export function noteLocalRestore(snapshot: LedgerDataSnapshot): void {
  saveBase(snapshot)
}

function newConfig(role: SyncRole): SyncConfig {
  return {
    role,
    enabled: false,
    deviceId: generateDeviceId(),
    code: null,
    pairingId: null,
    url: null,
    auto: true,
    priority: 'ask',
  }
}

function storedPriority(): SyncPriority {
  return config?.priority ?? 'ask'
}

/** Auto syncs use the saved default; `ask` falls back to the edit-time rule. */
function activePriority(): SyncFavor {
  const stored = storedPriority()
  return sessionPriority ?? (stored === 'ask' ? 'latest' : stored)
}

/**
 * Maps "phone/desktop wins" onto this device's local/remote labels. `latest`
 * leaves it to merge.ts, which compares each record's updatedAt.
 */
function favorOf(priority: SyncFavor): MergeOptions {
  if (priority === 'latest') return {}
  const localIsPhone = runtimeRole === 'mobile'
  if (priority === 'phone') {
    return { favor: localIsPhone ? 'local' : 'remote' }
  }
  return { favor: localIsPhone ? 'remote' : 'local' }
}

function emitPhase(patch: Partial<SyncUiState>): void {
  if (!quietSync) emit(patch)
}

// Deriving the key is deliberately slow (PBKDF2). Cache per code so an
// eight-second background poll costs one HTTP request, not two derivations.
let keyCache: { code: string; key: CryptoKey } | null = null
let tokenCache: { code: string; token: string } | null = null

async function syncKey(): Promise<CryptoKey> {
  const code = config!.code!
  if (keyCache?.code === code) return keyCache.key
  const key = await deriveSyncKey(code)
  keyCache = { code, key }
  return key
}

async function syncToken(): Promise<string> {
  const code = config!.code!
  if (tokenCache?.code === code) return tokenCache.token
  const token = await deriveSyncToken(code)
  tokenCache = { code, token }
  return token
}

function invokeDesktop<T>(command: string, args?: Record<string, unknown>) {
  return import('@tauri-apps/api/core').then(({ invoke }) =>
    invoke<T>(command, args),
  )
}

export async function initSync(): Promise<void> {
  if (initialized) return
  initialized = true

  const stored = readJson<SyncConfig>(CONFIG_KEY)
  if (stored && stored.role === runtimeRole) {
    config = {
      ...newConfig(runtimeRole),
      ...stored,
      role: runtimeRole,
      deviceId: stored.deviceId || generateDeviceId(),
    }
  }
  meta = { ...defaultMeta(), ...(readJson<SyncMeta>(META_KEY) ?? {}) }
  base = readBase()

  emit({
    ready: true,
    enabled: config?.enabled === true,
    role: runtimeRole,
    code: config?.code ?? null,
    url: config?.url ?? null,
    auto: config?.auto ?? true,
    hasBase: base !== null,
    priority: config?.priority ?? 'ask',
    pendingPriority: false,
    lastSyncAt: meta.lastSyncAt,
    phase: syncSupported
      ? config?.enabled
        ? 'idle'
        : 'disabled'
      : 'disabled',
    message: !syncSupported
      ? '双端同步仅在电脑版和手机版中可用'
      : config?.enabled
        ? ''
        : '同步未开启',
  })

  if (!syncSupported) return

  if (runtimeRole === 'desktop') {
    if (config?.enabled) {
      await startDesktopServer().catch((error) => {
        if (config) {
          config.enabled = false
          saveConfig()
        }
        emit({ enabled: false, running: false })
        reportError(error)
      })
    }
    return
  }

  if (config?.enabled && config.url && config.code && config.pairingId) {
    setupMobileWatchers()
    void runMobileSync('startup')
  }
}

function reportError(error: unknown): void {
  const message = describeError(error)
  emit({ phase: 'error', lastError: message, message })
}

function describeError(error: unknown): string {
  if (error instanceof SyncHttpError || error instanceof Error) {
    return error.message
  }
  if (typeof error === 'string') return error
  return '同步失败，请稍后再试'
}

function hasLedgerData(snapshot: LedgerDataSnapshot): boolean {
  return (
    snapshot.transactions.length > 0 ||
    snapshot.projects.length > 0 ||
    snapshot.liabilities.length > 0 ||
    snapshot.budgetRanges.length > 0 ||
    Object.keys(snapshot.budgets).length > 0
  )
}

function recordCount(snapshot: LedgerDataSnapshot): number {
  return (
    snapshot.transactions.length +
    snapshot.projects.length +
    snapshot.liabilities.length
  )
}

function emitReload(): void {
  window.dispatchEvent(new CustomEvent(RELOAD_EVENT))
}

function applySyncedSnapshot(
  snapshot: LedgerDataSnapshot,
): LedgerDataSnapshot {
  applyingSyncedData = true
  try {
    const applied = applyLedgerDataSnapshot(snapshot)
    syncApplied = true
    emitReload()
    return applied
  } finally {
    applyingSyncedData = false
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/* ------------------------------------------------------------------ */
/* Desktop: host the encrypted blob                                    */
/* ------------------------------------------------------------------ */

function applyServerStatus(status: DesktopServerStatus): void {
  emit({
    running: status.running,
    port: status.port,
    addresses: status.addresses,
    lastPeerAt: status.lastPeerAt,
    hasBase: base !== null,
  })
}

function setupDesktopWatchers(): void {
  if (!changeUnsubscribe) {
    changeUnsubscribe = onLedgerChanged(() => {
      if (!config?.enabled || runtimeRole !== 'desktop') return
      if (applyingSyncedData) return
      if (desktopChangeTimer !== null) window.clearTimeout(desktopChangeTimer)
      desktopChangeTimer = window.setTimeout(() => {
        desktopChangeTimer = null
        void publishDesktopSnapshot().catch(() => undefined)
      }, DESKTOP_CHANGE_DELAY)
    })
  }
}

function teardownDesktopWatchers(): void {
  if (desktopChangeTimer !== null) {
    window.clearTimeout(desktopChangeTimer)
    desktopChangeTimer = null
  }
  if (changeUnsubscribe) {
    changeUnsubscribe()
    changeUnsubscribe = null
  }
}

async function startDesktopServer(): Promise<void> {
  if (!config || config.role !== 'desktop') return
  if (!config.code) config.code = generateSyncCode()
  if (!config.pairingId) config.pairingId = generatePairingId()
  config.enabled = true
  config.url = null
  saveConfig()

  const token = await syncToken()
  const status = await invokeDesktop<DesktopServerStatus>('sync_server_start', {
    token,
    pairingId: config.pairingId,
    version: __APP_VERSION__,
    deviceName: '电脑',
    preferredPort: null,
  })
  applyServerStatus(status)

  if (!desktopUnlisten) {
    const { listen } = await import('@tauri-apps/api/event')
    const unlisten = await listen('sync-blob-received', () => {
      queueIncomingBlob()
    })
    desktopUnlisten = unlisten
  }

  emit({
    enabled: true,
    phase: 'idle',
    lastError: null,
    message: '等待手机连接',
    code: config.code,
  })

  if (desktopStatusTimer === null) {
    desktopStatusTimer = window.setInterval(() => {
      void refreshDesktopStatus().catch(() => undefined)
    }, DESKTOP_STATUS_INTERVAL)
  }
  setupDesktopWatchers()

  // A phone may have pushed while this app was closed.
  await queueIncomingBlob().catch(() => undefined)
  await publishDesktopSnapshot().catch(() => undefined)
}

function queueIncomingBlob(): Promise<void> {
  incomingChain = incomingChain
    .then(() => handleIncomingBlob())
    .catch((error) => {
      console.error('处理手机同步数据失败', error)
    })
  return incomingChain
}

async function handleIncomingBlob(): Promise<void> {
  if (!config || config.role !== 'desktop' || !config.enabled) return
  const read = await invokeDesktop<BlobRead | null>('sync_server_read_blob')
  if (!read?.contents) return

  const key = await syncKey()
  let envelope
  try {
    envelope = parseSyncEnvelope(read.contents)
  } catch {
    return
  }
  let payload: SyncPayload
  try {
    payload = await decryptPayload(envelope, key)
  } catch {
    // Not ours, or the phone used a stale code. The server already refused the
    // write without the right token, so this is only a leftover from an old
    // pairing; leave it alone rather than deleting it.
    return
  }
  if (payload.pairingId !== config.pairingId) return
  if (payload.sender !== 'mobile') return
  if (payload.seq <= meta.lastMobileSeq) return
  // Leave the blob untouched while a form is open; closing it re-queues this.
  if (syncSuspended) return

  emit({ phase: 'merging', message: '正在合并手机上的账目…', lastError: null })
  const current = readLedgerDataSnapshot()
  const priority = payload.priority ?? 'latest'
  const merged =
    payload.mode === 'replace'
      ? { snapshot: payload.snapshot, conflicts: [] }
      : mergeSnapshots(base, current, payload.snapshot, favorOf(priority))

  // Applying a merged snapshot fires the change watcher; never publish that
  // echo back as if the user had edited something here.
  let applied = payload.snapshot
  if (!snapshotsEqual(merged.snapshot, current)) {
    applied = applySyncedSnapshot(merged.snapshot)
  } else {
    applied = merged.snapshot
  }

  saveBase(applied)
  meta.lastSyncAt = new Date().toISOString()

  // Reply with the merged result so the phone can pick up edits that were made
  // here while it was away. Writing through the HTTP API with If-Match means a
  // phone push that landed meanwhile wins instead of being overwritten.
  const nextSeq = meta.seq + 1
  const reply: SyncPayload = {
    v: 1,
    sender: 'desktop',
    deviceId: config.deviceId,
    pairingId: config.pairingId!,
    seq: nextSeq,
    ack: payload.seq,
    sentAt: new Date().toISOString(),
    mode: 'snapshot',
    priority,
    snapshot: applied,
  }
  const envelopeOut = await encryptPayload(reply, key)
  try {
    const writtenEtag = await invokeDesktop<string | null>(
      'sync_server_write_blob_if',
      {
        contents: JSON.stringify(envelopeOut),
        expectedEtag: read.etag,
      },
    )
    if (writtenEtag) meta.seq = nextSeq
    // A null result means a newer phone push arrived; its handler will answer.
  } catch (error) {
    // Leave lastMobileSeq alone so a restart handles this push again.
    persistMeta()
    const message = describeError(error)
    emit({ phase: 'error', message, lastError: message })
    return
  }

  meta.lastMobileSeq = payload.seq
  persistMeta()
  // Flush anything edited here while the reply was being encrypted, so the
  // phone's next poll sees it even though this reply was already built.
  void publishDesktopSnapshot().catch(() => undefined)
  emit({
    phase: 'success',
    message: '已与手机同步',
    lastSyncAt: meta.lastSyncAt,
    lastError: null,
    conflictCount: merged.conflicts.length,
    lastPeerAt: new Date().toISOString(),
  })
}

/**
 * Writes the desktop's current books into the blob so a phone that has never
 * synced can see them before its first push.
 */
async function publishDesktopSnapshot(): Promise<void> {
  if (!config || config.role !== 'desktop' || !config.enabled) return
  const read = await invokeDesktop<BlobRead | null>('sync_server_read_blob')
  const key = await syncKey()

  if (read?.contents) {
    try {
      const existing = await decryptPayload(
        parseSyncEnvelope(read.contents),
        key,
      )
      if (
        existing.sender === 'mobile' &&
        existing.pairingId === config.pairingId &&
        existing.seq > meta.lastMobileSeq
      ) {
        // A push is waiting to be merged; the reply will publish our books.
        return
      }
      if (
        existing.sender === 'desktop' &&
        snapshotsEqual(existing.snapshot, readLedgerDataSnapshot())
      ) {
        return
      }
    } catch {
      // Unreadable leftovers are replaced below.
    }
  }

  const current = readLedgerDataSnapshot()
  // Before pairing, an empty book must not overwrite the phone's data. Once a
  // base exists, an empty book is a real deletion and has to travel.
  if (!hasLedgerData(current) && !base) return

  const nextSeq = meta.seq + 1
  const payload: SyncPayload = {
    v: 1,
    sender: 'desktop',
    deviceId: config.deviceId,
    pairingId: config.pairingId!,
    seq: nextSeq,
    sentAt: new Date().toISOString(),
    mode: 'snapshot',
    snapshot: current,
  }
  const envelope = await encryptPayload(payload, key)
  const writtenEtag = await invokeDesktop<string | null>(
    'sync_server_write_blob_if',
    {
      contents: JSON.stringify(envelope),
      expectedEtag: read?.etag ?? null,
    },
  )
  if (!writtenEtag) return
  meta.seq = nextSeq
  persistMeta()
}

export async function enableDesktopSync(): Promise<void> {
  if (runtimeRole !== 'desktop') throw new Error('只有电脑版能开启同步服务')
  if (!config) config = newConfig('desktop')
  emit({ phase: 'connecting', message: '正在启动同步服务…', lastError: null })
  try {
    await startDesktopServer()
  } catch (error) {
    config.enabled = false
    saveConfig()
    emit({ enabled: false, running: false })
    reportError(error)
    throw error
  }
}

export async function disableSync(): Promise<void> {
  if (directionResolver) {
    const resolver = directionResolver
    directionResolver = null
    resolver('cancel')
  }
  if (priorityResolver) {
    const resolver = priorityResolver
    priorityResolver = null
    resolver('cancel')
  }
  sessionPriority = null
  if (runtimeRole === 'desktop') {
    if (desktopStatusTimer !== null) {
      window.clearInterval(desktopStatusTimer)
      desktopStatusTimer = null
    }
    if (desktopUnlisten) {
      desktopUnlisten()
      desktopUnlisten = null
    }
    teardownDesktopWatchers()
    await invokeDesktop('sync_server_stop').catch(() => undefined)
  } else {
    teardownMobileWatchers()
  }
  if (config) {
    config.enabled = false
    saveConfig()
  }
  emit({
    enabled: false,
    running: false,
    port: null,
    addresses: [],
    lastPeerAt: null,
    phase: 'disabled',
    message: '同步已关闭',
    lastError: null,
    pendingDirection: null,
    pendingPriority: false,
  })
}

/** Desktop: forget the current phone and issue a fresh code. */
export async function resetPairing(): Promise<void> {
  if (runtimeRole !== 'desktop' || !config) return
  const wasEnabled = config.enabled
  teardownDesktopWatchers()
  if (desktopUnlisten) {
    desktopUnlisten()
    desktopUnlisten = null
  }
  if (desktopStatusTimer !== null) {
    window.clearInterval(desktopStatusTimer)
    desktopStatusTimer = null
  }
  await invokeDesktop('sync_server_stop').catch(() => undefined)
  await invokeDesktop('sync_server_write_blob', { contents: '' }).catch(
    () => undefined,
  )

  config.code = generateSyncCode()
  config.pairingId = generatePairingId()
  config.enabled = wasEnabled
  saveConfig()
  meta = defaultMeta()
  persistMeta()
  saveBase(null)
  emit({
    code: config.code,
    running: false,
    port: null,
    addresses: [],
    lastPeerAt: null,
    lastSyncAt: null,
    conflictCount: 0,
    message: wasEnabled ? '正在重新配对…' : '同步码已更新',
  })
  if (wasEnabled) {
    await startDesktopServer()
  }
}

export async function refreshDesktopStatus(): Promise<void> {
  if (runtimeRole !== 'desktop' || !config?.enabled) return
  const status = await invokeDesktop<DesktopServerStatus>('sync_server_status')
  applyServerStatus(status)
}

export async function syncNow(): Promise<void> {
  if (runtimeRole === 'desktop') {
    await refreshDesktopStatus().catch(() => undefined)
    await queueIncomingBlob()
    await publishDesktopSnapshot().catch(() => undefined)
    return
  }
  await runMobileSync('manual')
}

/* ------------------------------------------------------------------ */
/* Mobile: pull, merge, push                                           */
/* ------------------------------------------------------------------ */

class StaleBlobError extends Error {}
class SyncCancelledError extends Error {}

export async function connectMobile(
  rawUrl: string,
  rawCode: string,
): Promise<void> {
  if (runtimeRole !== 'mobile') throw new Error('只有手机版能连接到电脑')
  const code = normalizeSyncCode(rawCode)
  if (!isValidSyncCode(code)) {
    throw new Error('同步码应为 10 位字母或数字')
  }
  const url = normalizeSyncUrl(rawUrl)

  emit({ phase: 'connecting', message: '正在连接电脑…', lastError: null })
  const info = await fetchSyncInfo(url)

  const previous = config
  const pairingChanged =
    !previous ||
    !previous.pairingId ||
    previous.pairingId !== info.pairingId ||
    previous.code !== code

  // A paired phone with a shared base can ask how to resolve edits made on
  // both sides. The first pairing has no base yet; its direction prompt below
  // covers that case instead.
  let remembered: SyncPriority | null = null
  if (!pairingChanged && base && (previous?.priority ?? 'ask') === 'ask') {
    const answer = await requestPriority()
    if (answer === 'cancel') {
      emit({
        phase: 'disabled',
        message: '已取消连接',
        lastError: null,
        pendingPriority: false,
      })
      throw new SyncCancelledError('已取消连接')
    }
    sessionPriority = answer.choice
    if (answer.remember) remembered = answer.choice
  }

  try {
    config = {
      role: 'mobile',
      enabled: true,
      deviceId: previous?.deviceId ?? generateDeviceId(),
      code,
      pairingId: info.pairingId,
      url,
      auto: previous?.auto ?? true,
      priority: remembered ?? previous?.priority ?? 'ask',
    }
    saveConfig()

    if (pairingChanged) {
      meta = defaultMeta()
      persistMeta()
      saveBase(null)
    }

    emit({
      enabled: true,
      code,
      url,
      priority: config.priority ?? 'ask',
      message: `已找到「${info.name}」`,
    })
    setupMobileWatchers()
    await runMobileSync('manual')
    if (ui.phase === 'error') {
      const message = ui.lastError ?? '连接电脑失败'
      teardownMobileWatchers()
      config.enabled = false
      saveConfig()
      emit({ enabled: false, phase: 'error', message, lastError: message })
      throw new Error(message)
    }
  } finally {
    sessionPriority = null
  }
}

export async function disconnectMobile(): Promise<void> {
  if (runtimeRole !== 'mobile') return
  teardownMobileWatchers()
  sessionPriority = null
  if (config) {
    config.enabled = false
    saveConfig()
  }
  emit({
    enabled: false,
    phase: 'disabled',
    message: '已断开电脑',
    lastError: null,
    pendingDirection: null,
    pendingPriority: false,
  })
}

export async function setSyncAuto(auto: boolean): Promise<void> {
  if (!config) return
  config.auto = auto
  saveConfig()
  emit({ auto })
  if (auto && runtimeRole === 'mobile' && config.enabled) {
    void runMobileSync('manual')
  }
}

/**
 * Saves the conflict rule for future connections. `ask` restores the prompt
 * shown whenever the phone connects.
 */
export function setSyncPriority(priority: SyncPriority): void {
  if (!config || config.role !== 'mobile') return
  config.priority = priority
  saveConfig()
  emit({ priority })
}

export function resolveDirection(choice: DirectionChoice): void {
  const resolver = directionResolver
  directionResolver = null
  emit({ pendingDirection: null, message: '' })
  resolver?.(choice)
}

export function resolvePriority(
  choice: SyncFavor | 'cancel',
  remember = false,
): void {
  const resolver = priorityResolver
  priorityResolver = null
  emit({ pendingPriority: false, message: '' })
  if (!resolver) return
  if (choice === 'cancel') resolver('cancel')
  else resolver({ choice, remember })
}

function requestPriority(): Promise<PriorityAnswer | 'cancel'> {
  return new Promise((resolve) => {
    priorityResolver = resolve
    emit({
      pendingPriority: true,
      phase: 'idle',
      message: '请选择这次连接遇到冲突时以哪边为准',
    })
  })
}

function requestDirection(
  localCount: number,
  remoteCount: number,
): Promise<DirectionChoice | 'cancel'> {
  return new Promise((resolve) => {
    directionResolver = resolve
    emit({
      pendingDirection: { localCount, remoteCount },
      phase: 'idle',
      message: '首次同步需要选择以哪一边为准',
    })
  })
}

function setupMobileWatchers(): void {
  if (!changeUnsubscribe) {
    changeUnsubscribe = onLedgerChanged(() => {
      if (!config?.enabled || !config.auto) return
      if (applyingSyncedData) return
      if (mobileChangeTimer !== null) window.clearTimeout(mobileChangeTimer)
      mobileChangeTimer = window.setTimeout(() => {
        mobileChangeTimer = null
        void runMobileSync('change')
      }, MOBILE_CHANGE_DELAY)
    })
  }
  document.addEventListener('visibilitychange', handleVisible)
  window.addEventListener('focus', handleFocus)
  if (mobilePollTimer === null) {
    // The desktop cannot reach the phone, so while the phone is on screen it
    // checks the shared blob regularly instead of waiting for a manual sync.
    mobilePollTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible' || syncSuspended) return
      if (!config?.enabled || !config.auto) return
      void runMobileSync('poll')
    }, MOBILE_POLL_INTERVAL)
  }
}

function teardownMobileWatchers(): void {
  document.removeEventListener('visibilitychange', handleVisible)
  window.removeEventListener('focus', handleFocus)
  if (mobileChangeTimer !== null) {
    window.clearTimeout(mobileChangeTimer)
    mobileChangeTimer = null
  }
  if (mobilePollTimer !== null) {
    window.clearInterval(mobilePollTimer)
    mobilePollTimer = null
  }
  if (changeUnsubscribe) {
    changeUnsubscribe()
    changeUnsubscribe = null
  }
}

function handleVisible(): void {
  if (document.visibilityState !== 'visible') return
  if (syncSuspended || !config?.enabled || !config.auto) return
  void runMobileSync('resume')
}

function handleFocus(): void {
  if (syncSuspended || !config?.enabled || !config.auto) return
  void runMobileSync('resume')
}

async function runMobileSync(trigger: SyncTrigger): Promise<void> {
  if (!config || config.role !== 'mobile' || !config.enabled) return
  if (!config.url || !config.code || !config.pairingId) return
  if (syncing) {
    if (trigger === 'manual') syncAgain = true
    return
  }
  syncing = true
  const quiet = trigger === 'poll'
  quietSync = quiet
  syncApplied = false
  emitPhase({
    phase: 'connecting',
    message: '正在连接电脑…',
    lastError: null,
  })
  try {
    await performMobileSyncWithRetry()
    if (!quiet) {
      emit({
        phase: 'success',
        message: '已与电脑同步',
        lastError: null,
        lastSyncAt: meta.lastSyncAt,
        hasBase: base !== null,
      })
    } else if (syncApplied) {
      emit({
        phase: 'success',
        message: '已收到电脑上的改动',
        lastError: null,
        lastSyncAt: meta.lastSyncAt,
        hasBase: base !== null,
      })
    } else {
      emit({ lastSyncAt: meta.lastSyncAt })
    }
  } catch (error) {
    if (error instanceof SyncCancelledError) {
      return
    }
    if (quiet) {
      // A silent poll should not turn a brief Wi-Fi hiccup into a red banner.
      console.warn('后台同步失败', error)
      return
    }
    const message = describeError(error)
    emit({
      phase: 'error',
      message,
      lastError: message,
      pendingDirection: null,
    })
  } finally {
    quietSync = false
    syncing = false
    if (syncAgain) {
      syncAgain = false
      void runMobileSync('change')
    }
  }
}

async function performMobileSyncWithRetry(): Promise<void> {
  let attempts = 0
  for (;;) {
    try {
      await performMobileSync()
      return
    } catch (error) {
      if (error instanceof StaleBlobError && attempts < 2) {
        attempts += 1
        continue
      }
      throw error
    }
  }
}

interface PushResult {
  etag: string | null
  seq: number
}

async function performMobileSync(): Promise<void> {
  const cfg = config!
  const key = await syncKey()
  const token = await syncToken()

  const remote = await fetchSyncBlob(cfg.url!, token)
  let remotePayload: SyncPayload | null = null
  if (remote?.text) {
    let envelope
    try {
      envelope = parseSyncEnvelope(remote.text)
    } catch {
      throw new Error('电脑上的同步数据无法识别，请重新配对')
    }
    try {
      remotePayload = await decryptPayload(envelope, key)
    } catch {
      throw new Error('同步码不匹配，请对照电脑上显示的同步码')
    }
    if (remotePayload.pairingId !== cfg.pairingId) {
      throw new Error('电脑已经重新配对，请重新输入同步码')
    }
  }

  const alreadyApplied =
    remotePayload?.sender === 'desktop' &&
    remotePayload.seq <= meta.lastDesktopSeq
  const remoteSnapshot = alreadyApplied ? null : (remotePayload?.snapshot ?? null)
  const remoteEtag = remote?.etag ?? null

  const local = readLedgerDataSnapshot()

  // A poll that overlapped with a form being opened must not rewrite the books
  // under it. Nothing has been recorded as applied yet, so the next poll can
  // handle the same blob.
  if (quietSync && syncSuspended) return

  if (!base) {
    await firstSync(local, remoteSnapshot, remotePayload, remoteEtag)
    return
  }

  if (!remoteSnapshot) {
    if (!snapshotsEqual(local, base)) {
      const pushed = await pushSnapshot(local, 'snapshot', remoteEtag)
      saveBase(local)
      meta.lastSyncAt = new Date().toISOString()
      persistMeta()
      await fetchReply(key, token, pushed.seq)
    } else {
      meta.lastSyncAt = new Date().toISOString()
      persistMeta()
    }
    return
  }

  if (remotePayload?.sender === 'desktop') {
    meta.lastDesktopSeq = Math.max(meta.lastDesktopSeq, remotePayload.seq)
    persistMeta()
  }

  emitPhase({ phase: 'merging', message: '正在合并两边的账目…' })

  const merged = mergeSnapshots(
    base,
    local,
    remoteSnapshot,
    favorOf(activePriority()),
  )
  let applied = local
  if (!snapshotsEqual(merged.snapshot, local)) {
    applied = applySyncedSnapshot(merged.snapshot)
  }

  emitPhase({ conflictCount: merged.conflicts.length })

  if (snapshotsEqual(applied, remoteSnapshot)) {
    // The desktop is already up to date; nothing to push.
    saveBase(snapshotsEqual(applied, base) ? base : applied)
    meta.lastSyncAt = new Date().toISOString()
    persistMeta()
    return
  }

  const pushed = await pushSnapshot(applied, 'snapshot', remoteEtag)
  saveBase(applied)
  meta.lastSyncAt = new Date().toISOString()
  persistMeta()
  await fetchReply(key, token, pushed.seq)
}

async function firstSync(
  local: LedgerDataSnapshot,
  remoteSnapshot: LedgerDataSnapshot | null,
  remotePayload: SyncPayload | null,
  remoteEtag: string | null,
): Promise<void> {
  if (!remoteSnapshot) {
    emitPhase({ phase: 'pushing', message: '正在把账目写入电脑…' })
    const pushed = await pushSnapshot(local, 'snapshot', remoteEtag)
    saveBase(local)
    meta.lastSyncAt = new Date().toISOString()
    persistMeta()
    await fetchReply(await syncKey(), await syncToken(), pushed.seq)
    return
  }

  if (!hasLedgerData(local)) {
    // Nothing here yet: adopt the desktop's books as-is.
    const applied = applySyncedSnapshot(remoteSnapshot)
    if (remotePayload?.sender === 'desktop') {
      meta.lastDesktopSeq = Math.max(meta.lastDesktopSeq, remotePayload.seq)
    }
    // Push the adopted snapshot back so the desktop records it as the shared
    // base. Without a base it cannot tell later deletions from additions.
    const pushed = await pushSnapshot(applied, 'snapshot', remoteEtag)
    saveBase(applied)
    meta.lastSyncAt = new Date().toISOString()
    persistMeta()
    await fetchReply(
      await syncKey(),
      await syncToken(),
      pushed.seq,
    )
    return
  }

  if (!hasLedgerData(remoteSnapshot)) {
    emitPhase({ phase: 'pushing', message: '正在把账目写入电脑…' })
    const pushed = await pushSnapshot(local, 'snapshot', remoteEtag)
    saveBase(local)
    meta.lastSyncAt = new Date().toISOString()
    persistMeta()
    await fetchReply(
      await syncKey(),
      await syncToken(),
      pushed.seq,
    )
    return
  }

  const choice = await requestDirection(recordCount(local), recordCount(remoteSnapshot))
  if (choice === 'cancel') throw new SyncCancelledError('已取消同步')

  if (choice === 'remote') {
    const applied = applySyncedSnapshot(remoteSnapshot)
    if (remotePayload?.sender === 'desktop') {
      meta.lastDesktopSeq = Math.max(meta.lastDesktopSeq, remotePayload.seq)
    }
    const pushed = await pushSnapshot(applied, 'snapshot', remoteEtag)
    saveBase(applied)
    meta.lastSyncAt = new Date().toISOString()
    persistMeta()
    await fetchReply(await syncKey(), await syncToken(), pushed.seq)
    return
  }

  if (choice === 'local') {
    // The desktop drops its own books and adopts this phone's.
    emitPhase({ phase: 'pushing', message: '正在替换电脑上的账目…' })
    const normalized = applySyncedSnapshot(local)
    const pushed = await pushSnapshot(normalized, 'replace', remoteEtag)
    saveBase(normalized)
    meta.lastSyncAt = new Date().toISOString()
    persistMeta()
    await fetchReply(
      await syncKey(),
      await syncToken(),
      pushed.seq,
    )
    return
  }

  const merged = mergeSnapshots(
    null,
    local,
    remoteSnapshot,
    favorOf(activePriority()),
  )
  let applied = local
  if (!snapshotsEqual(merged.snapshot, local)) {
    applied = applySyncedSnapshot(merged.snapshot)
  }
  emitPhase({ conflictCount: merged.conflicts.length })
  emitPhase({ phase: 'pushing', message: '正在把合并结果写入电脑…' })
  const pushed = await pushSnapshot(applied, 'snapshot', remoteEtag)
  saveBase(applied)
  meta.lastSyncAt = new Date().toISOString()
  persistMeta()
  await fetchReply(
    await syncKey(),
    await syncToken(),
    pushed.seq,
  )
}

async function pushSnapshot(
  snapshot: LedgerDataSnapshot,
  mode: SyncPayload['mode'],
  etag: string | null,
): Promise<PushResult> {
  const cfg = config!
  const key = await syncKey()
  const token = await syncToken()
  const seq = meta.seq + 1
  const payload: SyncPayload = {
    v: 1,
    sender: 'mobile',
    deviceId: cfg.deviceId,
    pairingId: cfg.pairingId!,
    seq,
    sentAt: new Date().toISOString(),
    mode,
    priority: activePriority(),
    snapshot,
  }
  const envelope = await encryptPayload(payload, key)
  emitPhase({ phase: 'pushing', message: '正在写入电脑…' })
  const result = await pushSyncBlob(
    cfg.url!,
    token,
    JSON.stringify(envelope),
    etag,
  )
  if (result.conflict) {
    throw new StaleBlobError('电脑上的账目刚刚更新，正在重试')
  }
  meta.seq = seq
  persistMeta()
  return { etag: result.etag, seq }
}

/**
 * After a push the desktop merges and writes its own snapshot back. Pull that
 * reply once so concurrent edits made on the computer are not delayed until
 * the next manual sync.
 */
async function fetchReply(
  key: CryptoKey,
  token: string,
  pushedSeq: number,
): Promise<void> {
  const cfg = config
  if (!cfg?.url) return
  await wait(REPLY_DELAY)
  let remote
  try {
    remote = await fetchSyncBlob(cfg.url, token)
  } catch {
    return
  }
  if (!remote?.text) return
  let payload: SyncPayload
  try {
    payload = await decryptPayload(parseSyncEnvelope(remote.text), key)
  } catch {
    return
  }
  if (payload.sender !== 'desktop' || payload.ack !== pushedSeq) return
  if (quietSync && syncSuspended) return

  const local = readLedgerDataSnapshot()
  const merged = mergeSnapshots(
    base,
    local,
    payload.snapshot,
    favorOf(payload.priority ?? activePriority()),
  )
  if (!snapshotsEqual(merged.snapshot, local)) {
    applySyncedSnapshot(merged.snapshot)
  }
  saveBase(payload.snapshot)
  meta.lastDesktopSeq = Math.max(meta.lastDesktopSeq, payload.seq)
  meta.lastSyncAt = new Date().toISOString()
  persistMeta()
}

/** Display helper for the settings screen. */
export function formattedCode(): string | null {
  return config?.code ? formatSyncCode(config.code) : null
}
