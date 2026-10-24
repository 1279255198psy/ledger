import { useCallback, useEffect, useRef, useState } from 'react'
import type { Account } from '../types'
import { ingestCaptureEvents } from '../lib/capture/ingest'
import { captureSupported } from '../lib/capture/native'
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
) {
  const [items, setItems] = useState<PendingCapture[]>(
    () => loadInboxState().items,
  )
  const accountsRef = useRef(accounts)
  const callbackRef = useRef(onNewItems)
  const inFlight = useRef(false)

  useEffect(() => {
    accountsRef.current = accounts
  }, [accounts])

  useEffect(() => {
    callbackRef.current = onNewItems
  }, [onNewItems])

  const ingest = useCallback(async (): Promise<number> => {
    if (!captureSupported() || inFlight.current) return 0
    inFlight.current = true
    try {
      const result = await ingestCaptureEvents(accountsRef.current)
      if (result.scanned > 0) {
        setItems(loadInboxState().items)
      }
      if (result.added > 0) callbackRef.current?.(result.added)
      return result.added
    } finally {
      inFlight.current = false
    }
  }, [])

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
