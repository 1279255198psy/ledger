import type { Account } from '../../types'
import { localDateKey } from '../utils'
import { captureEventText, parseCaptureEvent } from './parse'
import type {
  CaptureConfidence,
  CaptureEventRecord,
  CaptureInboxState,
  CaptureSourceEvidence,
  PendingCapture,
} from './types'

const STORAGE_KEY = 'zhangye.captureInbox.v1'
/** Card tail → account id, learned when the user annotates a bank notice. */
const TAIL_KEY = 'zhangye.captureAccountTails.v1'
const KEEP_DAYS = 30
const MAX_PENDING = 200
/** WeChat and a bank often both announce the same payment seconds apart. */
const MERGE_WINDOW_MS = 2 * 60 * 1000

export function emptyInboxState(): CaptureInboxState {
  return {
    version: 1,
    items: [],
    seenEventIds: [],
    updatedAt: new Date().toISOString(),
  }
}

export function loadInboxState(): CaptureInboxState {
  if (typeof window === 'undefined') return emptyInboxState()
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return emptyInboxState()
  }
  if (!raw) return emptyInboxState()
  try {
    const parsed = JSON.parse(raw) as Partial<CaptureInboxState> | null
    if (!parsed || !Array.isArray(parsed.items)) return emptyInboxState()
    const items = parsed.items.filter(isPendingCapture)
    const seenEventIds = Array.isArray(parsed.seenEventIds)
      ? parsed.seenEventIds.filter((id): id is string => typeof id === 'string')
      : []
    return {
      version: 1,
      items,
      seenEventIds,
      updatedAt:
        typeof parsed.updatedAt === 'string'
          ? parsed.updatedAt
          : new Date().toISOString(),
    }
  } catch {
    return emptyInboxState()
  }
}

export function saveInboxState(state: CaptureInboxState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // A full disk must not stop the ledger from working; the native queue
    // still holds the raw notifications until the next successful write.
  }
}

function isPendingCapture(value: unknown): value is PendingCapture {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<PendingCapture>
  return (
    typeof item.id === 'string' &&
    typeof item.occurredAt === 'number' &&
    Number.isFinite(item.occurredAt) &&
    (item.status === 'pending' ||
      item.status === 'accepted' ||
      item.status === 'ignored') &&
    Array.isArray(item.sources)
  )
}

/** Turns one raw notification into a pending item, keeping whatever it has. */
export function buildPendingCapture(
  event: CaptureEventRecord,
  accounts: Account[],
): PendingCapture {
  const parsed = parseCaptureEvent(event)
  const occurredAt =
    event.postedAt > 0
      ? event.postedAt
      : event.capturedAt > 0
        ? event.capturedAt
        : Date.now()
  const account = matchAccount(event, parsed, accounts)
  const issues = [...parsed.issues]
  if (!account.id && parsed.direction !== 'refund' && parsed.direction !== 'transfer') {
    issues.push('未匹配到账户')
  }
  const now = new Date().toISOString()
  const source: CaptureSourceEvidence = {
    packageName: event.packageName,
    appLabel: event.appLabel || event.packageName,
    title: event.title,
    text: event.bigText || event.text,
    postedAt: occurredAt,
  }

  return {
    id: `capture-${event.id}`,
    status: 'pending',
    direction: parsed.direction,
    amountCents: parsed.amountCents,
    date: localDateKey(new Date(occurredAt)),
    occurredAt,
    merchant: parsed.merchant,
    accountId: account.id,
    accountLabel: account.label,
    cardTail: parsed.cardTail,
    confidence: confidenceFor(parsed, account.id),
    issues,
    rawText: captureEventText(event),
    sources: [source],
    createdAt: now,
    updatedAt: now,
  }
}

function confidenceFor(
  parsed: ReturnType<typeof parseCaptureEvent>,
  accountId: string,
): CaptureConfidence {
  if (parsed.amountCents === null || parsed.direction === 'unknown') {
    return 'low'
  }
  if (parsed.direction === 'refund' || parsed.direction === 'transfer') {
    return 'medium'
  }
  return accountId ? 'high' : 'medium'
}

function matchAccount(
  event: CaptureEventRecord,
  parsed: ReturnType<typeof parseCaptureEvent>,
  accounts: Account[],
): { id: string; label: string } {
  const walletType =
    event.packageName === 'com.tencent.mm'
      ? 'wechat'
      : event.packageName === 'com.eg.android.AlipayGphone'
        ? 'alipay'
        : null
  if (walletType) {
    const wallet = accounts.find((account) => account.type === walletType)
    if (wallet) return { id: wallet.id, label: wallet.name }
  }

  const cards = accounts.filter((account) => account.type === 'bank')
  if (parsed.cardTail) {
    const learnedId = loadTailMap()[parsed.cardTail]
    if (learnedId) {
      const learned = cards.find((account) => account.id === learnedId)
      if (learned) return { id: learned.id, label: learned.name }
    }
    const byTail = cards.find(
      (account) =>
        account.name.includes(parsed.cardTail) ||
        account.id.includes(parsed.cardTail),
    )
    if (byTail) return { id: byTail.id, label: byTail.name }
  }
  if (parsed.bankName) {
    const byBank = cards.find((account) => {
      const bank = account.bank ?? ''
      return (
        (bank.length > 0 && bank.includes(parsed.bankName)) ||
        account.name.includes(parsed.bankName)
      )
    })
    if (byBank) return { id: byBank.id, label: byBank.name }
  }

  const fallback = cards.find((account) => account.id === 'bank') ?? cards[0]
  if (fallback) return { id: fallback.id, label: fallback.name }
  return { id: '', label: '' }
}

/**
 * Adds a parsed item, merging it into an existing pending one when the same
 * purchase was announced by two different apps. The user still sees both
 * sources, so a wrong merge is easy to spot.
 */
export function mergePendingCapture(
  items: PendingCapture[],
  next: PendingCapture,
): { items: PendingCapture[]; merged: boolean } {
  const index = items.findIndex((item) => canMerge(item, next))
  if (index < 0) {
    return { items: sortItems([next, ...items]), merged: false }
  }

  const existing = items[index]
  const mergedItem: PendingCapture = {
    ...existing,
    direction:
      existing.direction === 'unknown' ? next.direction : existing.direction,
    amountCents: existing.amountCents ?? next.amountCents,
    merchant: existing.merchant || next.merchant,
    accountId: existing.accountId || next.accountId,
    accountLabel: existing.accountLabel || next.accountLabel,
    cardTail: existing.cardTail || next.cardTail,
    confidence:
      confidenceRank(existing.confidence) >= confidenceRank(next.confidence)
        ? existing.confidence
        : next.confidence,
    issues: mergeIssues(existing, next),
    rawText: `${existing.rawText}\n---\n${next.rawText}`,
    sources: [...existing.sources, ...next.sources],
    occurredAt: Math.min(existing.occurredAt, next.occurredAt),
    updatedAt: new Date().toISOString(),
  }
  const nextItems = [...items]
  nextItems[index] = mergedItem
  return { items: sortItems(nextItems), merged: true }
}

function mergeIssues(
  existing: PendingCapture,
  next: PendingCapture,
): string[] {
  const merged = new Set([...existing.issues, ...next.issues])
  if (existing.amountCents !== null || next.amountCents !== null) {
    merged.delete('未识别到金额')
  }
  if (existing.direction !== 'unknown' || next.direction !== 'unknown') {
    merged.delete('未判断出收支方向')
  }
  if (existing.accountId || next.accountId) merged.delete('未匹配到账户')
  return [...merged]
}

function canMerge(existing: PendingCapture, next: PendingCapture): boolean {
  if (existing.status !== 'pending') return false
  if (Math.abs(existing.occurredAt - next.occurredAt) > MERGE_WINDOW_MS) {
    return false
  }
  if (
    existing.amountCents !== null &&
    next.amountCents !== null &&
    existing.amountCents !== next.amountCents
  ) {
    return false
  }
  if (
    existing.direction !== 'unknown' &&
    next.direction !== 'unknown' &&
    existing.direction !== next.direction
  ) {
    return false
  }
  // Two notices from the same app are two events, not one payment.
  const packages = new Set(existing.sources.map((source) => source.packageName))
  return next.sources.every((source) => !packages.has(source.packageName))
}

function loadTailMap(): Record<string, string> {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(TAIL_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const map: Record<string, string> = {}
    for (const [tail, accountId] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (/^\d{3,4}$/.test(tail) && typeof accountId === 'string') {
        map[tail] = accountId
      }
    }
    return map
  } catch {
    return {}
  }
}

/**
 * Learns which card a tail belongs to the first time the user annotates it, so
 * later bank notices can preselect the right account without asking again.
 */
function rememberAccountTail(tail: string, accountId: string): void {
  if (!tail || !accountId || typeof window === 'undefined') return
  const map = loadTailMap()
  map[tail] = accountId
  try {
    window.localStorage.setItem(TAIL_KEY, JSON.stringify(map))
  } catch {
    // Matching falls back to the bank name next time.
  }
}

function confidenceRank(confidence: CaptureConfidence): number {
  if (confidence === 'high') return 2
  if (confidence === 'medium') return 1
  return 0
}

export function sortItems(items: PendingCapture[]): PendingCapture[] {
  return [...items].sort((left, right) => right.occurredAt - left.occurredAt)
}

export function pruneInbox(items: PendingCapture[]): PendingCapture[] {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000
  const kept = items.filter((item) => {
    if (item.status === 'pending') return true
    const stamp = Date.parse(item.updatedAt)
    return Number.isFinite(stamp) && stamp >= cutoff
  })

  const pending = kept.filter((item) => item.status === 'pending')
  if (pending.length <= MAX_PENDING) return sortItems(kept)
  const keepIds = new Set(
    pending
      .slice()
      .sort((left, right) => right.occurredAt - left.occurredAt)
      .slice(0, MAX_PENDING)
      .map((item) => item.id),
  )
  return sortItems(
    kept.filter((item) => item.status !== 'pending' || keepIds.has(item.id)),
  )
}

function updateItem(
  id: string,
  update: (item: PendingCapture) => PendingCapture,
): PendingCapture[] {
  const state = loadInboxState()
  const now = new Date().toISOString()
  const items = state.items.map((item) =>
    item.id === id ? { ...update(item), updatedAt: now } : item,
  )
  saveInboxState({ ...state, items, updatedAt: now })
  return sortItems(items)
}

export function markCaptureAccepted(
  id: string,
  transactionId: string,
  accountId?: string,
): PendingCapture[] {
  const state = loadInboxState()
  const now = new Date().toISOString()
  const target = state.items.find((item) => item.id === id)
  const items = state.items.map((item) =>
    item.id === id
      ? {
          ...item,
          status: 'accepted' as const,
          linkedTransactionId: transactionId,
          acceptedAt: now,
          updatedAt: now,
        }
      : item,
  )
  saveInboxState({ ...state, items, updatedAt: now })
  if (target?.cardTail && accountId) {
    rememberAccountTail(target.cardTail, accountId)
  }
  return sortItems(items)
}

export function markCaptureIgnored(id: string): PendingCapture[] {
  return updateItem(id, (item) => ({
    ...item,
    status: 'ignored',
    ignoredAt: new Date().toISOString(),
  }))
}
