import { useEffect } from 'react'
import type { SavingsHolding, SavingsReminderSettings } from '../types'
import { isDesktopApp } from '../lib/desktop'
import { isMobileApp } from '../lib/platform'
import { applySavingsReminderSchedule } from '../lib/reminderChannels'
import {
  SAVINGS_REMINDER_TITLE,
  parseSavingsReminderTime,
  savingsMilestonesDueToday,
} from '../lib/savingsReminders'
import { localDateKey } from '../lib/utils'

const LAST_FIRED_KEY = 'zhangye.savingsReminderLastFired.v1'

function readLastFired(): string[] {
  try {
    const raw = window.localStorage.getItem(LAST_FIRED_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string')
      : []
  } catch {
    return []
  }
}

function writeLastFired(keys: string[]): void {
  try {
    window.localStorage.setItem(LAST_FIRED_KEY, JSON.stringify(keys))
  } catch {
    // Without storage a notification can repeat while the page stays open.
  }
}

/**
 * Keeps the native savings maturity schedule in step with the holdings.
 * Desktop and Android outlive the window, so their schedules are rebuilt by
 * native code; the browser preview checks while the tab is open.
 */
export function useSavingsReminderScheduler(
  settings: SavingsReminderSettings,
  holdings: SavingsHolding[],
): void {
  useEffect(() => {
    let active = true
    applySavingsReminderSchedule(settings, holdings).catch((error) => {
      if (active) console.error('应用储蓄到期提醒失败', error)
    })
    return () => {
      active = false
    }
  }, [settings, holdings])

  useEffect(() => {
    if (!isMobileApp()) return
    const reapply = () => {
      if (document.visibilityState !== 'visible') return
      applySavingsReminderSchedule(settings, holdings).catch((error) => {
        console.error('应用储蓄到期提醒失败', error)
      })
    }
    document.addEventListener('visibilitychange', reapply)
    return () => document.removeEventListener('visibilitychange', reapply)
  }, [settings, holdings])

  useEffect(() => {
    if (isMobileApp() || isDesktopApp()) return
    if (!settings.enabled) return
    if (typeof window === 'undefined' || typeof Notification === 'undefined') {
      return
    }

    const tick = () => {
      if (Notification.permission !== 'granted') return
      const today = localDateKey()
      const { hour, minute } = parseSavingsReminderTime(settings.time)
      const now = new Date()
      if (now.getHours() !== hour || now.getMinutes() !== minute) return
      const milestones = savingsMilestonesDueToday(holdings, today)
      if (milestones.length === 0) return
      const fired = readLastFired()
      const newlyFired: string[] = []
      for (const milestone of milestones) {
        const key = `${today}:${milestone.key}`
        if (fired.includes(key) || newlyFired.includes(key)) continue
        new Notification(SAVINGS_REMINDER_TITLE, { body: milestone.body })
        newlyFired.push(key)
      }
      if (newlyFired.length > 0) {
        writeLastFired([...fired, ...newlyFired].slice(-120))
      }
    }

    tick()
    const timer = window.setInterval(tick, 30_000)
    return () => window.clearInterval(timer)
  }, [settings, holdings])
}
