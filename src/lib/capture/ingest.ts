import type { Account } from '../../types'
import { ackCaptureEvents, captureSupported, listCaptureEvents } from './native'
import {
  buildPendingCapture,
  loadInboxState,
  mergePendingCapture,
  pruneInbox,
  saveInboxState,
} from './pending'
import { loadKeepSamples } from './prefs'

export interface CaptureIngestResult {
  /** Notifications read from the native queue. */
  scanned: number
  /** New pending items. */
  added: number
  /** Notifications folded into an existing item (WeChat + bank). */
  merged: number
}

const EMPTY_RESULT: CaptureIngestResult = { scanned: 0, added: 0, merged: 0 }

/**
 * Moves raw notifications into the local pending queue. The raw file is
 * acknowledged only after the queue is written, so a crash between the two
 * steps re-reads the same notices instead of losing them.
 */
export async function ingestCaptureEvents(
  accounts: Account[],
): Promise<CaptureIngestResult> {
  if (!captureSupported()) return EMPTY_RESULT

  let events
  try {
    events = await listCaptureEvents()
  } catch (error) {
    console.warn('读取通知样本失败', error)
    return EMPTY_RESULT
  }

  const state = loadInboxState()
  const seen = new Set(state.seenEventIds)
  const fresh = events.filter((event) => !seen.has(event.id))
  if (fresh.length === 0) return EMPTY_RESULT

  let items = state.items
  let added = 0
  let merged = 0
  const ingestedIds: string[] = []

  for (const event of fresh) {
    const next = buildPendingCapture(event, accounts)
    const result = mergePendingCapture(items, next)
    items = result.items
    if (result.merged) merged += 1
    else added += 1
    ingestedIds.push(event.id)
  }

  const now = new Date().toISOString()
  saveInboxState({
    version: 1,
    items: pruneInbox(items),
    // The native file keeps 500 events, so remembering a little more than that
    // is enough to survive a failed ack without duplicating items.
    seenEventIds: [...state.seenEventIds, ...ingestedIds].slice(-800),
    updatedAt: now,
  })

  // Calibration mode keeps the raw notices on the debug page. The seen ids
  // above still prevent a second ingest, so nothing duplicates.
  if (loadKeepSamples()) return { scanned: fresh.length, added, merged }

  try {
    await ackCaptureEvents(fresh.map((event) => event.id))
  } catch (error) {
    // The ids above already prevent a second ingest; the native ring buffer
    // will drop these eventually.
    console.warn('清理已读取的通知样本失败', error)
  }

  return { scanned: fresh.length, added, merged }
}
