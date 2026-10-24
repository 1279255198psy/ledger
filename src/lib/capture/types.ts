/**
 * Phase 0 of automatic bookkeeping: raw payment notifications collected by the
 * Android listener. Nothing here is a ledger entry yet — it is the sample data
 * the parser will be built and tuned against.
 */
export interface CaptureEventRecord {
  id: string
  packageName: string
  appLabel: string
  title: string
  text: string
  bigText: string
  subText: string
  /** Epoch milliseconds, from the system notification. */
  postedAt: number
  /** Epoch milliseconds, when the listener stored it. */
  capturedAt: number
  /** System notification key, used to collapse updates of the same notice. */
  key: string
}

export interface CaptureStatus {
  /** The user granted notification access to 账页. */
  granted: boolean
  /** The listener service is bound right now. */
  connected: boolean
  /** Packages the listener watches. */
  packages: string[]
  /** How many days of samples to keep. */
  keepDays: number
  /** Stored sample count. */
  count: number
  /** Raw `enabled_notification_listeners` value from the system setting. */
  enabledListeners: string
}

/** Per-package listener counters; distinguishes "nothing arrived" from "filtered". */
export interface CaptureDiagnosticEntry {
  packageName: string
  label: string
  /** Notifications seen from this package, before any filter. */
  seen: number
  /** Epoch milliseconds of the most recent one. */
  lastSeen: number
  /** Notifications that passed the filters and were stored. */
  accepted: number
  lastAccepted: number
  /** Most recent notification text, truncated. */
  lastText: string
  /** Why the most recent one was rejected; empty when it was accepted. */
  lastReason: string
}

export interface CaptureDiagnostics {
  granted: boolean
  connected: boolean
  appPackage: string
  enabledListeners: string
  entries: CaptureDiagnosticEntry[]
}

export interface CaptureAppInfo {
  packageName: string
  label: string
  selected: boolean
}

/** What the notification appears to describe. */
export type CaptureDirection =
  | 'expense'
  | 'income'
  | 'refund'
  | 'transfer'
  | 'unknown'

export type CaptureConfidence = 'high' | 'medium' | 'low'

/** One notification that contributed to a pending capture. */
export interface CaptureSourceEvidence {
  packageName: string
  appLabel: string
  title: string
  text: string
  postedAt: number
}

/**
 * A payment extracted from notifications and waiting for the user to fill in
 * the category and spending nature. It lives only on this device and never
 * enters the synced ledger snapshot until it becomes a transaction.
 */
export interface PendingCapture {
  id: string
  status: 'pending' | 'accepted' | 'ignored'
  direction: CaptureDirection
  /** null when the amount could not be read; the raw text is kept. */
  amountCents: number | null
  /** Local calendar day the payment happened, YYYY-MM-DD. */
  date: string
  /** Epoch milliseconds from the notification. */
  occurredAt: number
  merchant: string
  /** Empty when no account matched. */
  accountId: string
  accountLabel: string
  cardTail: string
  confidence: CaptureConfidence
  /** Human-readable reasons the parse is incomplete. */
  issues: string[]
  rawText: string
  sources: CaptureSourceEvidence[]
  linkedTransactionId?: string
  acceptedAt?: string
  ignoredAt?: string
  createdAt: string
  updatedAt: string
}

export interface CaptureInboxState {
  version: 1
  items: PendingCapture[]
  /**
   * Native event ids already turned into pending items. Acks normally remove
   * them; this list keeps a failed ack from duplicating an item later.
   */
  seenEventIds: string[]
  updatedAt: string
}
