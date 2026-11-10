import { useCallback, useEffect, useRef, useState } from 'react'
import type { Account } from '../types'
import { ingestCaptureEvents } from '../lib/capture/ingest'
import { captureSupported } from '../lib/capture/native'
import {
  ensureCaptureStartDate,
  loadCaptureStartDate,
} from '../lib/capture/prefs'
import { localDateKey } from '../lib/utils'
import {
  loadInboxState,
  markCaptureAccepted,
  markCaptureIgnored,
} from '../lib/capture/pending'
import type { PendingCapture } from '../lib/capture/types'

const POLL_MS = 45_000

/**
 * Keeps the local pending queue in sync with the native notification inbox.
 * Everything stays on this device; accepted items become normal transactions.
 */
export function useCaptureInbox(
  accounts: Account[],
  onNewItems?: (count: number) => void,
  /** Fires once, when this device's capture start date is first recorded. */
  onCaptureStart?: (dateKey: string) => void,
) {
  const [items, setItems] = useState<PendingCapture[]>(
    () => loadInboxState().items,
  )
  const accountsRef = useRef(accounts)
  const callbackRef = useRef(onNewItems)
  const captureStartRef = useRef(onCaptureStart)
  const inFlight = useRef(false)

  useEffect(() => {
    accountsRef.current = accounts
  }, [accounts])

  useEffect(() => {
    callbackRef.current = onNewItems
  }, [onNewItems])

  useEffect(() => {
    captureStartRef.current = onCaptureStart
  }, [onCaptureStart])

  /**
   * Records the earliest notification date capture has actually seen. Old
   * notices delivered before the app was first opened still count, so the
   * coverage note does not claim capture began later than it did.
   */
  const recordCaptureStart = useCallback(() => {
    if (loadCaptureStartDate()) return
    const earliest = loadInboxState().items.reduce<string | null>(
      (min, item) => (min === null || item.date < min ? item.date : min),
      null,
    )
    const startDate = ensureCaptureStartDate(earliest ?? localDateKey())
    if (startDate) captureStartRef.current?.(startDate)
  }, [])

  const ingest = useCallback(async (): Promise<number> => {
    if (!captureSupported() || inFlight.current) return 0
    inFlight.current = true
    try {
      const result = await ingestCaptureEvents(accountsRef.current)
      if (result.scanned > 0) {
        recordCaptureStart()
        setItems(loadInboxState().items)
      }
      if (result.added > 0) callbackRef.current?.(result.added)
      return result.added
    } finally {
      inFlight.current = false
    }
  }, [recordCaptureStart])

  useEffect(() => {
    if (!captureSupported()) return
    void ingest()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void ingest()
    }, POLL_MS)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') void ingest()
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisible)
    }
  }, [ingest])

  const accept = useCallback(
    (id: string, transactionId: string, accountId?: string) => {
      setItems(markCaptureAccepted(id, transactionId, accountId))
    },
    [],
  )

  const ignore = useCallback((id: string) => {
    setItems(markCaptureIgnored(id))
  }, [])

  return { items, ingest, accept, ignore }
}
