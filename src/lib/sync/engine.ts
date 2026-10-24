import { isDesktopApp } from '../desktop'
import { isMobileApp } from '../platform'
import {
  applyLedgerDataSnapshot,
  onLedgerChanged,
  readLedgerDataSnapshot,
} from '../storage'
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
import { mergeSnapshots, snapshotsEqual } from './merge'
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
  SyncPayload,
  SyncRole,
  SyncUiState,
} from './types'

const CONFIG_KEY = 'zhangye.sync.config.v1'
const BASE_KEY = 'zhangye.sync.base.v1'
const META_KEY = 'zhangye.sync.meta.v1'
const RELOAD_EVENT = 'zhangye:ledger-reloaded'

const MOBILE_CHANGE_DELAY = 2000
const DESKTOP_STATUS_INTERVAL = 15000
const REPLY_DELAY = 400

type DirectionChoice = 'merge' | 'local' | 'remote'
type SyncTrigger = 'startup' | 'manual' | 'resume' | 'change'

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
let desktopUnlisten: (() => void) | null = null
let desktopStatusTimer: number | null = null
let changeUnsubscribe: (() => void) | null = null
let mobileChangeTimer: number | null = null
let incomingChain: Promise<void> = Promise.resolve()
let suppressChangeUntil = 0

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
}

export function getSyncState(): SyncUiState {
  return ui
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

function removeKey(key: string): void {
  try {
    window.localStorage.removeItem(key)
  } catch {
    // Ignore unavailable storage.
  }
}

function saveConfig(): void {
  if (config) writeJson(CONFIG_KEY, config)
}

function persistMeta(): void {
  writeJson(META_KEY, meta)
}

function saveBase(snapshot: LedgerDataSnapshot | null): void {
  base = snapshot
  if (snapshot) writeJson(BASE_KEY, snapshot)
  else removeKey(BASE_KEY)
  emit({ hasBase: snapshot !== null })
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
  }
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
  base = readJson<LedgerDataSnapshot>(BASE_KEY)

  emit({
    ready: true,
    enabled: config?.enabled === true,
    role: runtimeRole,
    code: config?.code ?? null,
    url: config?.url ?? null,
    auto: config?.auto ?? true,
    hasBase: base !== null,
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

async function startDesktopServer(): Promise<void> {
  if (!config || config.role !== 'desktop') return
  if (!config.code) config.code = generateSyncCode()
  if (!config.pairingId) config.pairingId = generatePairingId()
  config.enabled = true
  config.url = null
  saveConfig()

  const token = await deriveSyncToken(config.code)
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

  const key = await deriveSyncKey(config.code!)
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

  emit({ phase: 'merging', message: '正在合并手机上的账目…', lastError: null })
  const current = readLedgerDataSnapshot()
  const merged =
    payload.mode === 'replace'
      ? { snapshot: payload.snapshot, conflicts: [] }
      : mergeSnapshots(base, current, payload.snapshot)

  let applied = payload.snapshot
  if (!snapshotsEqual(merged.snapshot, current)) {
    applied = applyLedgerDataSnapshot(merged.snapshot)
    emitReload()
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
  suppressChangeUntil = Date.now() + 3000
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
  const key = await deriveSyncKey(config.code!)

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
  if (!hasLedgerData(current)) return

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
  if (runtimeRole === 'desktop') {
    if (desktopStatusTimer !== null) {
      window.clearInterval(desktopStatusTimer)
      desktopStatusTimer = null
    }
    if (desktopUnlisten) {
      desktopUnlisten()
      desktopUnlisten = null
    }
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
  })
}

/** Desktop: forget the current phone and issue a fresh code. */
export async function resetPairing(): Promise<void> {
  if (runtimeRole !== 'desktop' || !config) return
  const wasEnabled = config.enabled
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

  config = {
    role: 'mobile',
    enabled: true,
    deviceId: previous?.deviceId ?? generateDeviceId(),
    code,
    pairingId: info.pairingId,
    url,
    auto: previous?.auto ?? true,
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
}

export async function disconnectMobile(): Promise<void> {
  if (runtimeRole !== 'mobile') return
  teardownMobileWatchers()
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

export function resolveDirection(choice: DirectionChoice): void {
  const resolver = directionResolver
  directionResolver = null
  emit({ pendingDirection: null, message: '' })
  resolver?.(choice)
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
      if (Date.now() < suppressChangeUntil) return
      if (mobileChangeTimer !== null) window.clearTimeout(mobileChangeTimer)
      mobileChangeTimer = window.setTimeout(() => {
        mobileChangeTimer = null
        if (Date.now() < suppressChangeUntil) return
        void runMobileSync('change')
      }, MOBILE_CHANGE_DELAY)
    })
  }
  document.addEventListener('visibilitychange', handleVisible)
  window.addEventListener('focus', handleFocus)
}

function teardownMobileWatchers(): void {
  document.removeEventListener('visibilitychange', handleVisible)
  window.removeEventListener('focus', handleFocus)
  if (mobileChangeTimer !== null) {
    window.clearTimeout(mobileChangeTimer)
    mobileChangeTimer = null
  }
  if (changeUnsubscribe) {
    changeUnsubscribe()
    changeUnsubscribe = null
  }
}

function handleVisible(): void {
  if (document.visibilityState !== 'visible') return
  if (!config?.enabled || !config.auto) return
  void runMobileSync('resume')
}

function handleFocus(): void {
  if (!config?.enabled || !config.auto) return
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
  emit({
    phase: 'connecting',
    message: '正在连接电脑…',
    lastError: null,
  })
  try {
    await performMobileSyncWithRetry()
    suppressChangeUntil = Date.now() + 3000
    emit({
      phase: 'success',
      message: '已与电脑同步',
      lastError: null,
      lastSyncAt: meta.lastSyncAt,
      hasBase: base !== null,
    })
  } catch (error) {
    if (error instanceof SyncCancelledError) {
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
  const key = await deriveSyncKey(cfg.code!)
  const token = await deriveSyncToken(cfg.code!)

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

  emit({ phase: 'merging', message: '正在合并两边的账目…' })

  const merged = mergeSnapshots(base, local, remoteSnapshot)
  let applied = local
  if (!snapshotsEqual(merged.snapshot, local)) {
    applied = applyLedgerDataSnapshot(merged.snapshot)
    emitReload()
  }

  emit({ conflictCount: merged.conflicts.length })

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
  const cfg = config!

  if (!remoteSnapshot) {
    emit({ phase: 'pushing', message: '正在把账目写入电脑…' })
    const pushed = await pushSnapshot(local, 'snapshot', remoteEtag)
    saveBase(local)
    meta.lastSyncAt = new Date().toISOString()
    persistMeta()
    await fetchReply(await deriveSyncKey(cfg.code!), await deriveSyncToken(cfg.code!), pushed.seq)
    return
  }

  if (!hasLedgerData(local)) {
    // Nothing here yet: adopt the desktop's books as-is.
    const applied = applyLedgerDataSnapshot(remoteSnapshot)
    if (remotePayload?.sender === 'desktop') {
      meta.lastDesktopSeq = Math.max(meta.lastDesktopSeq, remotePayload.seq)
    }
    emitReload()
    // Push the adopted snapshot back so the desktop records it as the shared
    // base. Without a base it cannot tell later deletions from additions.
    const pushed = await pushSnapshot(applied, 'snapshot', remoteEtag)
    saveBase(applied)
    meta.lastSyncAt = new Date().toISOString()
    persistMeta()
    await fetchReply(
      await deriveSyncKey(cfg.code!),
      await deriveSyncToken(cfg.code!),
      pushed.seq,
    )
    return
  }

  if (!hasLedgerData(remoteSnapshot)) {
    emit({ phase: 'pushing', message: '正在把账目写入电脑…' })
    const pushed = await pushSnapshot(local, 'snapshot', remoteEtag)
    saveBase(local)
    meta.lastSyncAt = new Date().toISOString()
    persistMeta()
    await fetchReply(
      await deriveSyncKey(cfg.code!),
      await deriveSyncToken(cfg.code!),
      pushed.seq,
    )
    return
  }

  const choice = await requestDirection(recordCount(local), recordCount(remoteSnapshot))
  if (choice === 'cancel') throw new SyncCancelledError('已取消同步')

  if (choice === 'remote') {
    const applied = applyLedgerDataSnapshot(remoteSnapshot)
    if (remotePayload?.sender === 'desktop') {
      meta.lastDesktopSeq = Math.max(meta.lastDesktopSeq, remotePayload.seq)
    }
    emitReload()
    const pushed = await pushSnapshot(applied, 'snapshot', remoteEtag)
    saveBase(applied)
    meta.lastSyncAt = new Date().toISOString()
    persistMeta()
    await fetchReply(await deriveSyncKey(cfg.code!), await deriveSyncToken(cfg.code!), pushed.seq)
    return
  }

  if (choice === 'local') {
    // The desktop drops its own books and adopts this phone's.
    emit({ phase: 'pushing', message: '正在替换电脑上的账目…' })
    const normalized = applyLedgerDataSnapshot(local)
    const pushed = await pushSnapshot(normalized, 'replace', remoteEtag)
    saveBase(normalized)
    meta.lastSyncAt = new Date().toISOString()
    persistMeta()
    await fetchReply(
      await deriveSyncKey(cfg.code!),
      await deriveSyncToken(cfg.code!),
      pushed.seq,
    )
    return
  }

  const merged = mergeSnapshots(null, local, remoteSnapshot)
  let applied = local
  if (!snapshotsEqual(merged.snapshot, local)) {
    applied = applyLedgerDataSnapshot(merged.snapshot)
    emitReload()
  }
  emit({ conflictCount: merged.conflicts.length })
  emit({ phase: 'pushing', message: '正在把合并结果写入电脑…' })
  const pushed = await pushSnapshot(applied, 'snapshot', remoteEtag)
  saveBase(applied)
  meta.lastSyncAt = new Date().toISOString()
  persistMeta()
  await fetchReply(
    await deriveSyncKey(cfg.code!),
    await deriveSyncToken(cfg.code!),
    pushed.seq,
  )
}

async function pushSnapshot(
  snapshot: LedgerDataSnapshot,
  mode: SyncPayload['mode'],
  etag: string | null,
): Promise<PushResult> {
  const cfg = config!
  const key = await deriveSyncKey(cfg.code!)
  const token = await deriveSyncToken(cfg.code!)
  const seq = meta.seq + 1
  const payload: SyncPayload = {
    v: 1,
    sender: 'mobile',
    deviceId: cfg.deviceId,
    pairingId: cfg.pairingId!,
    seq,
    sentAt: new Date().toISOString(),
    mode,
    snapshot,
  }
  const envelope = await encryptPayload(payload, key)
  emit({ phase: 'pushing', message: '正在写入电脑…' })
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

  const local = readLedgerDataSnapshot()
  const merged = mergeSnapshots(base, local, payload.snapshot)
  if (!snapshotsEqual(merged.snapshot, local)) {
    applyLedgerDataSnapshot(merged.snapshot)
    emitReload()
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
