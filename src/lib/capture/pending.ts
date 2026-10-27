import type { Account } from '../../types'
import { bulkRead, bulkWrite } from '../bulkStore'
import { localDateKey } from '../utils'
import { parseCaptureEvent } from './parse'
import type {
  CaptureConfidence,
  CaptureEventRecord,
  CaptureInboxState,
  CaptureSourceEvidence,
  PendingCapture,
} from './types'

/** Card tail → account id, learned when the user annotates a bank notice. */
const TAIL_KEY = 'zhangye.captureAccountTails.v1'
/** Resolved items keep only a short trail; they no longer affect bookkeeping. */
const KEEP_DAYS = 7
const MAX_PENDING = 200
/** The inbox is device-only, so it gets a byte budget as well as a count cap. */
const MAX_INBOX_BYTES = 256 * 1024
const MAX_EVIDENCE_CHARS = 500
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
  const raw = bulkRead('captureInbox')
  if (!raw) return emptyInboxState()
  try {
    const parsed = JSON.parse(raw) as Partial<CaptureInboxState> | null
    if (!parsed || !Array.isArray(parsed.items)) return emptyInboxState()
    const items = parsed.items
      .filter(isPendingCapture)
      .map(normalizeStoredItem)
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
  // IndexedDB carries the inbox now; the bulk store falls back to
  // localStorage by itself when needed.
  bulkWrite('captureInbox', JSON.stringify(state))
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

function truncateText(value: string): string {
  if (!value) return ''
  return value.length > MAX_EVIDENCE_CHARS
    ? value.slice(0, MAX_EVIDENCE_CHARS)
    : value
}

/**
 * Older builds stored the whole notice twice (`rawText` plus each source).
 * Drop the duplicate and clamp the evidence when an inbox is read back.
 */
function normalizeStoredItem(item: PendingCapture): PendingCapture {
  const clean = { ...item } as PendingCapture & { rawText?: string }
  if ('rawText' in clean) delete clean.rawText
  return stripEvidence({
    ...clean,
    sources: clean.sources.map((source) => ({
      ...source,
      title: truncateText(source.title),
      text: truncateText(source.text),
    })),
  })
}

/** Resolved items no longer need the full notice text; the title remains. */
function stripEvidence(item: PendingCapture): PendingCapture {
  if (item.status === 'pending') return item
  if (item.sources.every((source) => source.text === '')) return item
  return {
    ...item,
    sources: item.sources.map((source) => ({ ...source, text: '' })),
  }
}

function inboxBytes(items: PendingCapture[]): number {
  const raw = JSON.stringify(items)
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(raw).length
  }
  return raw.length * 2
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
    title: truncateText(event.title),
    text: truncateText(event.bigText || event.text),
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
  const kept = items
    .filter((item) => {
      if (item.status === 'pending') return true
      const stamp = Date.parse(item.updatedAt)
      return Number.isFinite(stamp) && stamp >= cutoff
    })
    .map(stripEvidence)

  const pending = kept.filter((item) => item.status === 'pending')
  let result = kept
  if (pending.length > MAX_PENDING) {
    const keepIds = new Set(
      pending
        .slice()
        .sort((left, right) => right.occurredAt - left.occurredAt)
        .slice(0, MAX_PENDING)
        .map((item) => item.id),
    )
    result = kept.filter(
      (item) => item.status !== 'pending' || keepIds.has(item.id),
    )
  }

  result = sortItems(result)
  if (inboxBytes(result) <= MAX_INBOX_BYTES) return result

  // Drop the oldest handled items first; pending ones are the user's work and
  // stay even if an unusually long notice pushes the inbox over budget.
  const trimmed = [...result]
  for (
    let index = trimmed.length - 1;
    index >= 0 && inboxBytes(trimmed) > MAX_INBOX_BYTES;
    index -= 1
  ) {
    if (trimmed[index].status !== 'pending') trimmed.splice(index, 1)
  }
  return trimmed
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
      ? stripEvidence({
          ...item,
          status: 'accepted' as const,
          linkedTransactionId: transactionId,
          acceptedAt: now,
          updatedAt: now,
        })
      : item,
  )
  saveInboxState({ ...state, items, updatedAt: now })
  if (target?.cardTail && accountId) {
    rememberAccountTail(target.cardTail, accountId)
  }
  return sortItems(items)
}

export function markCaptureIgnored(id: string): PendingCapture[] {
  return updateItem(id, (item) =>
    stripEvidence({
      ...item,
      status: 'ignored',
      ignoredAt: new Date().toISOString(),
    }),
  )
}
