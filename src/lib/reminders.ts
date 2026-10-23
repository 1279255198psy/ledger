import type { ReminderFrequency, ReminderSettings } from '../types'

export const REMINDER_TITLE = '账页 · 记账提醒'
export const REMINDER_BODY = '今天的花销记下来了吗？花一分钟，把收支补上。'

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6]
const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export const DEFAULT_REMINDERS: ReminderSettings = {
  enabled: true,
  time: '21:00',
  frequency: 'daily',
  weekdays: [...WEEKDAYS],
  autoStart: true,
}

export function isReminderFrequency(value: unknown): value is ReminderFrequency {
  return (
    value === 'daily' ||
    value === 'weekdays' ||
    value === 'weekends' ||
    value === 'custom'
  )
}

/** Repairs stored settings instead of letting one bad field break reminders. */
export function normalizeReminders(value: unknown): ReminderSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_REMINDERS }
  const record = value as Record<string, unknown>

  const frequency = isReminderFrequency(record.frequency)
    ? record.frequency
    : DEFAULT_REMINDERS.frequency
  const weekdays = Array.isArray(record.weekdays)
    ? [
        ...new Set(
          record.weekdays.filter(
            (day): day is number =>
              typeof day === 'number' &&
              Number.isInteger(day) &&
              day >= 0 &&
              day <= 6,
          ),
        ),
      ].sort((left, right) => left - right)
    : []

  return {
    enabled:
      typeof record.enabled === 'boolean'
        ? record.enabled
        : DEFAULT_REMINDERS.enabled,
    time:
      typeof record.time === 'string' && TIME_PATTERN.test(record.time)
        ? record.time
        : DEFAULT_REMINDERS.time,
    frequency,
    weekdays: weekdays.length > 0 ? weekdays : [...WEEKDAYS],
    autoStart:
      typeof record.autoStart === 'boolean'
        ? record.autoStart
        : DEFAULT_REMINDERS.autoStart,
  }
}

/** Weekdays the reminder is active on, for every frequency. */
export function activeWeekdays(settings: ReminderSettings): number[] {
  if (settings.frequency === 'daily') return [...WEEKDAYS]
  if (settings.frequency === 'weekdays') return [1, 2, 3, 4, 5]
  if (settings.frequency === 'weekends') return [0, 6]
  return settings.weekdays.length > 0 ? settings.weekdays : [...WEEKDAYS]
}

export function parseReminderTime(time: string): { hour: number; minute: number } {
  const match = TIME_PATTERN.exec(time)
  if (!match) return { hour: 21, minute: 0 }
  return { hour: Number(match[1]), minute: Number(match[2]) }
}

/** The next time a reminder should fire, or null when reminders are off. */
export function nextReminderDate(
  settings: ReminderSettings,
  now = new Date(),
): Date | null {
  if (!settings.enabled) return null
  const days = new Set(activeWeekdays(settings))
  if (days.size === 0) return null
  const { hour, minute } = parseReminderTime(settings.time)

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate() + offset,
      hour,
      minute,
      0,
      0,
    )
    if (!days.has(candidate.getDay())) continue
    if (candidate.getTime() > now.getTime()) return candidate
  }
  return null
}

/** "今天 21:00" / "明天 21:00" / "周三 21:00" / "提醒已关闭". */
export function describeNextReminder(
  settings: ReminderSettings,
  now = new Date(),
): string {
  if (!settings.enabled) return '提醒已关闭'
  const next = nextReminderDate(settings, now)
  if (!next) return '尚未选择提醒日期'
  const time = `${String(next.getHours()).padStart(2, '0')}:${String(
    next.getMinutes(),
  ).padStart(2, '0')}`
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  ).getTime()
  const startOfNext = new Date(
    next.getFullYear(),
    next.getMonth(),
    next.getDate(),
  ).getTime()
  const dayOffset = Math.round((startOfNext - startOfToday) / 86_400_000)
  if (dayOffset === 0) return `今天 ${time}`
  if (dayOffset === 1) return `明天 ${time}`
  return `${WEEKDAY_LABELS[next.getDay()]} ${time}`
}

export function isReminderDueNow(
  settings: ReminderSettings,
  now = new Date(),
): boolean {
  if (!settings.enabled) return false
  if (!activeWeekdays(settings).includes(now.getDay())) return false
  const { hour, minute } = parseReminderTime(settings.time)
  return now.getHours() === hour && now.getMinutes() === minute
}

/**
 * IDs used on Android. A fixed range makes cancel-and-reschedule safe after
 * the user changes the time or weekdays.
 */
export const MOBILE_REMINDER_IDS = Array.from({ length: 12 }, (_, index) => 6301 + index)

export interface MobileReminderSchedule {
  id: number
  title: string
  body: string
  schedule: {
    on: { hour: number; minute: number; weekday?: number }
    repeats: true
    allowWhileIdle: true
  }
}

/**
 * Builds the native schedules. Capacitor counts weekdays from Sunday = 1,
 * while JavaScript counts Sunday = 0.
 */
export function buildMobileSchedules(
  settings: ReminderSettings,
): MobileReminderSchedule[] {
  if (!settings.enabled) return []
  const { hour, minute } = parseReminderTime(settings.time)
  const days = activeWeekdays(settings)

  if (settings.frequency === 'daily') {
    return [
      {
        id: MOBILE_REMINDER_IDS[0],
        title: REMINDER_TITLE,
        body: REMINDER_BODY,
        schedule: {
          on: { hour, minute },
          repeats: true,
          allowWhileIdle: true,
        },
      },
    ]
  }

  return days.map((day) => ({
    id: MOBILE_REMINDER_IDS[1 + day],
    title: REMINDER_TITLE,
    body: REMINDER_BODY,
    schedule: {
      on: { weekday: day + 1, hour, minute },
      repeats: true,
      allowWhileIdle: true,
    },
  }))
}
