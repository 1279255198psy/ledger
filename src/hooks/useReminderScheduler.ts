import { useEffect } from 'react'
import type { ReminderSettings } from '../types'
import { isDesktopApp } from '../lib/desktop'
import { isMobileApp } from '../lib/platform'
import { applyReminderSchedule } from '../lib/reminderChannels'
import {
  REMINDER_BODY,
  REMINDER_TITLE,
  isReminderDueNow,
} from '../lib/reminders'

const LAST_FIRED_KEY = 'zhangye.reminderLastFired.v1'

function readLastFired(): string {
  try {
    return window.localStorage.getItem(LAST_FIRED_KEY) ?? ''
  } catch {
    return ''
  }
}

function writeLastFired(key: string): void {
  try {
    window.localStorage.setItem(LAST_FIRED_KEY, key)
  } catch {
    // Without storage the notification just fires once per open session.
  }
}

/**
 * Keeps the native schedulers in step with the settings. Desktop and Android
 * both outlive the window, so their schedules are rebuilt by native code; the
 * browser preview falls back to a timer while the tab is open.
 */
export function useReminderScheduler(settings: ReminderSettings): void {
  useEffect(() => {
    let active = true
    applyReminderSchedule(settings).catch((error) => {
      if (active) console.error('应用记账提醒设置失败', error)
    })
    return () => {
      active = false
    }
  }, [settings])

  useEffect(() => {
    if (isMobileApp() || isDesktopApp()) return
    if (!settings.enabled) return
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return
    }

    const tick = () => {
      if (Notification.permission !== 'granted') return
      if (!isReminderDueNow(settings)) return
      const now = new Date()
      const key = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
        2,
        '0',
      )}-${String(now.getDate()).padStart(2, '0')} ${settings.time}`
      if (readLastFired() === key) return
      writeLastFired(key)
      new Notification(REMINDER_TITLE, { body: REMINDER_BODY })
    }

    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [settings])
}
