import { useSyncExternalStore } from 'react'
import { getSyncState, subscribeSync } from '../lib/sync/engine'
import type { SyncUiState } from '../lib/sync/types'

/** Subscribes the UI to the sync engine's state. */
export function useSync(): SyncUiState {
  return useSyncExternalStore(subscribeSync, getSyncState, getSyncState)
}
