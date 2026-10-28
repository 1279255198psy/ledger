import type {
  Account,
  BudgetBook,
  Category,
  LedgerTransaction,
  Liability,
  Project,
  RangeBudget,
  RecurringPending,
  RecurringRule,
} from '../../types'

/**
 * The part of the ledger that travels between devices. Appearance and reminder
 * settings stay local; everything that changes the books is here.
 */
export interface LedgerDataSnapshot {
  app: '账页'
  syncVersion: 1
  updatedAt: string
  categories: Category[]
  /** Absent in snapshots created before custom bank cards existed. */
  accounts?: Account[]
  transactions: LedgerTransaction[]
  projects: Project[]
  liabilities: Liability[]
  budgets: BudgetBook
  budgetRanges: RangeBudget[]
  /** Absent in snapshots created before recurring entries existed. */
  recurringRules?: RecurringRule[]
  recurringPending?: RecurringPending[]
  openingBalanceCents: number
}

/** Which app produced an envelope. */
export type SyncSender = 'desktop' | 'mobile'

/**
 * How a sync resolves a record both devices changed since the last shared
 * base. `latest` compares the time the user edited the record (updatedAt), not
 * the transaction date. `ask` is only a stored preference: the phone asks at
 * connection time and never sends it over the wire.
 */
export type SyncPriority = 'ask' | 'latest' | 'phone' | 'desktop'

/** The concrete rule carried in a payload. */
export type SyncFavor = Exclude<SyncPriority, 'ask'>

/**
 * `replace` is only used for the explicit "use this phone's data" choice on
 * the first sync. It tells the desktop to adopt the snapshot without merging.
 */
export type SyncMode = 'snapshot' | 'replace'

/** The encrypted payload inside a sync envelope. */
export interface SyncPayload {
  v: 1
  sender: SyncSender
  deviceId: string
  pairingId: string
  /** Per-sender, strictly increasing. Used to reject replayed old snapshots. */
  seq: number
  /** Desktop only: the mobile seq this snapshot answers, so the phone knows
   *  it is looking at the result of its own push rather than an older blob. */
  ack?: number
  sentAt: string
  mode: SyncMode
  /** Mobile only: how both sides should resolve conflicting edits this round. */
  priority?: SyncFavor
  snapshot: LedgerDataSnapshot
}

/** What is actually stored on the desktop and transferred over HTTP. */
export interface SyncEnvelope {
  v: 1
  /** Base64, 12 bytes. */
  iv: string
  /** Base64 AES-GCM ciphertext. */
  data: string
}

export type SyncConflictKind =
  | 'transaction'
  | 'project'
  | 'liability'
  | 'repayment'
  | 'category'
  | 'account'
  | 'budget'
  | 'range'
  | 'recurringRule'
  | 'recurringPending'
  | 'openingBalance'
  | 'reference'

export interface SyncConflict {
  kind: SyncConflictKind
  id: string
  choice: 'local' | 'remote'
}

export interface MergeStats {
  added: number
  updated: number
  removed: number
}

export interface MergeResult {
  snapshot: LedgerDataSnapshot
  conflicts: SyncConflict[]
  stats: MergeStats
}

export type SyncRole = 'desktop' | 'mobile'

export type SyncPhase =
  | 'idle'
  | 'connecting'
  | 'merging'
  | 'pushing'
  | 'success'
  | 'error'
  | 'disabled'

export interface SyncUiState {
  ready: boolean
  role: SyncRole
  enabled: boolean
  phase: SyncPhase
  message: string
  lastSyncAt: string | null
  lastError: string | null
  conflictCount: number
  /** Desktop only. */
  running: boolean
  port: number | null
  addresses: string[]
  code: string | null
  lastPeerAt: string | null
  /** Mobile only. */
  url: string | null
  auto: boolean
  hasBase: boolean
  /** First sync needs a direction because both sides already have books. */
  pendingDirection: {
    localCount: number
    remoteCount: number
  } | null
  /** The phone is waiting for "this connection: phone or computer first". */
  pendingPriority: boolean
  /** Stored preference; `ask` means prompt on every explicit connection. */
  priority: SyncPriority
}

export interface SyncConfig {
  role: SyncRole
  enabled: boolean
  deviceId: string
  /** Desktop: the code shown to the phone. Mobile: the entered code. */
  code: string | null
  /** Desktop only, shared with the phone for envelope validation. */
  pairingId: string | null
  /** Mobile only. */
  url: string | null
  auto: boolean
  /** Mobile only: conflict rule; defaults to asking on each connection. */
  priority?: SyncPriority
}
