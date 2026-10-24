import type { ReminderSettings } from '../types'
import { isDesktopApp } from './desktop'
import { isMobileApp } from './platform'
import {
  MOBILE_REMINDER_IDS,
  REMINDER_BODY,
  REMINDER_TITLE,
  buildMobileSchedules,
} from './reminders'

export type ReminderPermission =
  | 'granted'
  | 'denied'
  | 'prompt'
  | 'unsupported'

export interface ReminderActionResult {
  ok: boolean
  message: string
}

let channelReady = false

type MobileNotificationsModule = typeof import('@capacitor/local-notifications')

let mobileModule: Promise<MobileNotificationsModule> | null = null

/**
 * Capacitor plugin objects are Proxies that turn *every* property access into a
 * native plugin call — including `then`. Returning one from an `async` function
 * (or otherwise awaiting it) makes the promise machinery call
 * `LocalNotifications.then()`, which the native side rejects as unimplemented
 * while the outer promise never settles. So only ever await the module and pull
 * the plugin out of it as a plain property.
 */
function loadMobileModule(): Promise<MobileNotificationsModule> {
  if (!mobileModule) mobileModule = import('@capacitor/local-notifications')
  return mobileModule
}

function toPermission(display: string): ReminderPermission {
  if (display === 'granted') return 'granted'
  if (display === 'denied') return 'denied'
  return 'prompt'
}

/** Reads the current permission without prompting the user. */
export async function getReminderPermission(): Promise<ReminderPermission> {
  if (isMobileApp()) {
    try {
      const { LocalNotifications: plugin } = await loadMobileModule()
      return toPermission((await plugin.checkPermissions()).display)
    } catch {
      return 'unsupported'
    }
  }
  if (isDesktopApp()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      return (await invoke<ReminderPermission>('reminder_permission_state')) ?? 'unsupported'
    } catch {
      return 'unsupported'
    }
  }
  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return 'unsupported'
  }
  return Notification.permission === 'granted'
    ? 'granted'
    : Notification.permission === 'denied'
      ? 'denied'
      : 'prompt'
}

async function ensureMobilePermission(): Promise<ReminderPermission> {
  const { LocalNotifications: plugin } = await loadMobileModule()
  const current = toPermission((await plugin.checkPermissions()).display)
  if (current !== 'prompt') return current
  return toPermission((await plugin.requestPermissions()).display)
}

async function ensureChannel(): Promise<void> {
  if (channelReady) return
  const { LocalNotifications: plugin } = await loadMobileModule()
  await plugin.createChannel({
    id: 'reminders',
    name: '记账提醒',
    description: '按设定时间提醒记录当天收支',
    importance: 4,
    visibility: 1,
    vibration: true,
    lights: true,
  })
  channelReady = true
}

/** Cancels every reminder this app owns. */
async function clearMobileReminders(): Promise<void> {
  const { LocalNotifications: plugin } = await loadMobileModule()
  await plugin.cancel({
    notifications: MOBILE_REMINDER_IDS.map((id) => ({ id })),
  })
}

async function applyMobile(settings: ReminderSettings): Promise<void> {
  if (!settings.enabled) {
    await clearMobileReminders()
    return
  }
  const permission = await ensureMobilePermission()
  if (permission !== 'granted') {
    await clearMobileReminders()
    return
  }
  await ensureChannel()
  await clearMobileReminders()
  const notifications = buildMobileSchedules(settings)
  if (notifications.length === 0) return
  const { LocalNotifications: plugin } = await loadMobileModule()
  // `isExactNotification: false` keeps Android from sending the user to the
  // "Alarms & reminders" permission screen here. Inexact alarms still survive
  // a closed app, and allowWhileIdle keeps them firing through Doze.
  await plugin.schedule({
    notifications: notifications.map((item) => ({
      ...item,
      channelId: 'reminders',
    })),
  })
}

/**
 * Applies the reminder settings on whichever platform is running. The desktop
 * app owns scheduling in Rust so reminders keep firing while minimized to the
 * tray; Android uses native local notifications that survive a closed app.
 */
export async function applyReminderSchedule(
  settings: ReminderSettings,
): Promise<void> {
  if (isMobileApp()) {
    await applyMobile(settings)
    return
  }
  if (isDesktopApp()) {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('sync_reminder_settings', { settings })
  }
}

export async function sendTestReminder(): Promise<ReminderActionResult> {
  if (isMobileApp()) {
    try {
      const permission = await ensureMobilePermission()
      if (permission !== 'granted') {
        return {
          ok: false,
          message: '通知权限未开启，请到系统设置里允许账页发送通知。',
        }
      }
      await ensureChannel()
      const { LocalNotifications: plugin } = await loadMobileModule()
      await plugin.schedule({
        notifications: [
          {
            id: 6399,
            title: REMINDER_TITLE,
            body: REMINDER_BODY,
            channelId: 'reminders',
            isExactNotification: false,
            // A one-shot `at` in the past is delivered immediately by the
            // plugin. Using a future time would go through AlarmManager, which
            // Android can delay (or block behind the exact-alarm permission).
            schedule: { at: new Date(Date.now() - 1000) },
          },
        ],
      })
      return { ok: true, message: '测试通知已发送，请看看通知栏。' }
    } catch (error) {
      console.error('测试提醒发送失败', error)
      const detail =
        typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message?: unknown }).message ?? '')
          : ''
      if (/disable|denied|not.*permission|permission/i.test(detail)) {
        return {
          ok: false,
          message: '系统里关闭了账页的通知，请到系统设置中允许通知后再试。',
        }
      }
      return { ok: false, message: '测试通知发送失败，请检查通知权限后重试。' }
    }
  }

  if (isDesktopApp()) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('send_test_notification')
      return { ok: true, message: '测试通知已发送。' }
    } catch {
      return { ok: false, message: '测试通知发送失败，请检查系统通知权限。' }
    }
  }

  if (typeof window === 'undefined' || typeof Notification === 'undefined') {
    return { ok: false, message: '当前环境不支持系统通知。' }
  }
  try {
    let permission = Notification.permission
    if (permission === 'default') {
      permission = await Notification.requestPermission()
    }
    if (permission !== 'granted') {
      return { ok: false, message: '浏览器通知权限未开启。' }
    }
    new Notification(REMINDER_TITLE, { body: REMINDER_BODY })
    return { ok: true, message: '测试通知已发送。' }
  } catch {
    return { ok: false, message: '测试通知发送失败。' }
  }
}
