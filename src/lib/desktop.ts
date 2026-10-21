import { downloadFile } from './utils'

export function isDesktopApp(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function loadDesktopLedger(): Promise<unknown | null> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<unknown | null>('load_ledger')
}

export async function saveDesktopLedger(data: unknown): Promise<void> {
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('save_ledger', { data })
}

export async function confirmDesktopAction(
  message: string,
  title = '账页',
): Promise<boolean> {
  if (!isDesktopApp()) return window.confirm(message)
  const { ask } = await import('@tauri-apps/plugin-dialog')
  return ask(message, { title, kind: 'warning' })
}

interface SaveTextFileOptions {
  fileName: string
  contents: string
  mimeType: string
  filterName: string
  extensions: string[]
}

/**
 * Uses the native save dialog in the desktop app, and a normal download in a
 * browser. Returns false when the user cancels the desktop dialog.
 */
export async function saveTextFile({
  fileName,
  contents,
  mimeType,
  filterName,
  extensions,
}: SaveTextFileOptions): Promise<boolean> {
  if (!isDesktopApp()) {
    downloadFile(fileName, contents, mimeType)
    return true
  }

  const [{ save }, { invoke }] = await Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/api/core'),
  ])
  const path = await save({
    defaultPath: fileName,
    filters: [{ name: filterName, extensions }],
  })
  if (!path) return false
  await invoke('write_export', { path, contents })
  return true
}
