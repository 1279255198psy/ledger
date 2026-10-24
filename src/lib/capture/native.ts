import { registerPlugin } from '@capacitor/core'
import { isAndroidApp } from '../platform'
import type {
  CaptureAppInfo,
  CaptureDiagnostics,
  CaptureEventRecord,
  CaptureStatus,
} from './types'

interface CaptureInboxPlugin {
  status(): Promise<CaptureStatus>
  reconnect(): Promise<void>
  diagnostics(): Promise<CaptureDiagnostics>
  openSettings(): Promise<void>
  listEvents(options?: { sinceId?: string }): Promise<{
    events: CaptureEventRecord[]
  }>
  ack(options: { ids: string[] }): Promise<void>
  clear(): Promise<void>
  setConfig(options: { packages?: string[]; keepDays?: number }): Promise<void>
  candidateApps(): Promise<{ apps: CaptureAppInfo[] }>
}

/**
 * The plugin only exists in the Android shell. On desktop and in the browser
 * every helper below refuses before touching the proxy, so a stray call can
 * never reach Capacitor's "not implemented" path.
 */
const CaptureInbox = registerPlugin<CaptureInboxPlugin>('CaptureInbox')

export function captureSupported(): boolean {
  return isAndroidApp()
}

function requireAndroid(): void {
  if (!captureSupported()) {
    throw new Error('通知捕获仅在 Android 版可用')
  }
}

export async function getCaptureStatus(): Promise<CaptureStatus> {
  requireAndroid()
  return CaptureInbox.status()
}

export async function openCaptureSettings(): Promise<void> {
  requireAndroid()
  await CaptureInbox.openSettings()
}

/** Asks the system to bind the listener again; fixes "granted but silent". */
export async function reconnectCaptureListener(): Promise<void> {
  requireAndroid()
  await CaptureInbox.reconnect()
}

export async function getCaptureDiagnostics(): Promise<CaptureDiagnostics> {
  requireAndroid()
  return CaptureInbox.diagnostics()
}

export async function listCaptureEvents(
  sinceId?: string,
): Promise<CaptureEventRecord[]> {
  requireAndroid()
  const { events } = await CaptureInbox.listEvents(
    sinceId ? { sinceId } : undefined,
  )
  return events
}

export async function ackCaptureEvents(ids: string[]): Promise<void> {
  requireAndroid()
  if (ids.length === 0) return
  await CaptureInbox.ack({ ids })
}

export async function clearCaptureEvents(): Promise<void> {
  requireAndroid()
  await CaptureInbox.clear()
}

export async function setCaptureConfig(config: {
  packages?: string[]
  keepDays?: number
}): Promise<void> {
  requireAndroid()
  await CaptureInbox.setConfig(config)
}

export async function listCaptureCandidateApps(): Promise<CaptureAppInfo[]> {
  requireAndroid()
  const { apps } = await CaptureInbox.candidateApps()
  return apps
}
