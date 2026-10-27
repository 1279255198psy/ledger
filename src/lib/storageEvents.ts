/**
 * Local storage failures used to be swallowed so a quota error could not crash
 * the ledger. That silence becomes dangerous once the browser's five megabyte
 * limit is reached: the entry looks saved and disappears on the next launch.
 * This module turns those failures into a one-off message the UI can show.
 */

type StorageErrorListener = (message: string) => void

const listeners = new Set<StorageErrorListener>()
let pendingMessage: string | null = null
let lastMessage = ''
let lastReportedAt = 0

const REPEAT_WINDOW_MS = 10_000
const REPLAY_WINDOW_MS = 60_000

function isQuotaError(error: unknown): boolean {
  if (typeof DOMException !== 'undefined' && error instanceof DOMException) {
    return (
      error.name === 'QuotaExceededError' ||
      error.name === 'NS_ERROR_DOM_QUOTA_REACHED'
    )
  }
  return (
    error instanceof Error &&
    /quota|storage.*full|空间已满/i.test(error.message)
  )
}

export function reportStorageError(error: unknown): void {
  const message = isQuotaError(error)
    ? '本地存储空间已满，新的改动可能无法保存。请先导出备份，再清理旧数据。'
    : '本地写入失败，最新的改动可能没有保存。请导出备份后重试。'
  const now = Date.now()
  if (message === lastMessage && now - lastReportedAt < REPEAT_WINDOW_MS) {
    return
  }
  lastMessage = message
  lastReportedAt = now
  pendingMessage = message

  for (const listener of listeners) {
    try {
      listener(message)
    } catch (listenerError) {
      console.error('存储错误监听失败', listenerError)
    }
  }
  // Keep the message around briefly for listeners that mount after boot.
  setTimeout(() => {
    if (pendingMessage === message) pendingMessage = null
  }, REPLAY_WINDOW_MS)
}

export function onStorageError(listener: StorageErrorListener): () => void {
  listeners.add(listener)
  if (pendingMessage) {
    const message = pendingMessage
    pendingMessage = null
    setTimeout(() => {
      try {
        listener(message)
      } catch (error) {
        console.error('存储错误监听失败', error)
      }
    }, 0)
  }
  return () => listeners.delete(listener)
}
