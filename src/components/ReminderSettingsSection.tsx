import { useEffect, useState } from 'react'
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  Clock3,
  MonitorDown,
  Send,
} from 'lucide-react'
import type { ReminderFrequency, ReminderSettings } from '../types'
import { isDesktopApp } from '../lib/desktop'
import { isMobileApp } from '../lib/platform'
import {
  applyReminderSchedule,
  getReminderPermission,
  sendTestReminder,
} from '../lib/reminderChannels'
import type { ReminderPermission } from '../lib/reminderChannels'
import {
  activeWeekdays,
  describeNextReminder,
  normalizeReminders,
} from '../lib/reminders'

const FREQUENCIES: { id: ReminderFrequency; label: string }[] = [
  { id: 'daily', label: '每天' },
  { id: 'weekdays', label: '工作日' },
  { id: 'weekends', label: '周末' },
  { id: 'custom', label: '自定义' },
]

const WEEKDAY_CHIPS = ['日', '一', '二', '三', '四', '五', '六']

const PERMISSION_COPY: Record<ReminderPermission, string> = {
  granted: '系统通知已开启',
  denied: '系统通知被关闭，提醒无法送达，请在系统设置中允许账页通知',
  prompt: '首次开启时会向系统申请通知权限',
  unsupported: '当前环境不支持系统通知，提醒只在应用内生效',
}

interface ReminderSettingsSectionProps {
  settings: ReminderSettings
  onChange: (settings: ReminderSettings) => void
  onNotify: (message: string, kind: 'success' | 'error') => void
}

export function ReminderSettingsSection({
  settings,
  onChange,
  onNotify,
}: ReminderSettingsSectionProps) {
  const [permission, setPermission] = useState<ReminderPermission>('prompt')
  const [testing, setTesting] = useState(false)
  const [now, setNow] = useState(() => new Date())

  const desktop = isDesktopApp()
  const mobile = isMobileApp()

  // Keep "next reminder" honest while the settings page stays open.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    let active = true
    getReminderPermission()
      .then((state) => {
        if (active) setPermission(state)
      })
      .catch(() => undefined)
    return () => {
      active = false
    }
  }, [settings.enabled])

  // The user may grant or revoke notifications from system settings while the
  // app is in the background; re-read the state when they come back.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      getReminderPermission()
        .then(setPermission)
        .catch(() => undefined)
    }
    document.addEventListener('visibilitychange', refresh)
    return () => document.removeEventListener('visibilitychange', refresh)
  }, [])

  const update = (patch: Partial<ReminderSettings>) => {
    onChange(normalizeReminders({ ...settings, ...patch }))
  }

  const handleToggle = async () => {
    const enabled = !settings.enabled
    update({ enabled })
    if (!enabled) return
    // Ask for the system permission at the moment the user turns reminders on,
    // so the prompt is tied to an action they just took.
    if (mobile) {
      await applyReminderSchedule({ ...settings, enabled }).catch(() => undefined)
    } else if (!desktop && typeof Notification !== 'undefined') {
      if (Notification.permission === 'default') {
        await Notification.requestPermission().catch(() => undefined)
      }
    }
    const nextPermission = await getReminderPermission()
    setPermission(nextPermission)
    if (enabled && nextPermission !== 'granted') {
      onNotify(
        mobile
          ? '通知权限还没有开启，提醒暂时无法送达；请在系统设置里允许账页通知，再回来打开提醒。'
          : '通知权限还没有开启，提醒暂时无法送达。',
        'error',
      )
    }
  }

  const handleFrequency = (frequency: ReminderFrequency) => {
    if (frequency === settings.frequency) return
    // Entering 自定义 starts from the days that were actually active, so the
    // chips never contradict the schedule the user just had.
    const weekdays =
      frequency === 'custom' ? activeWeekdays(settings) : settings.weekdays
    update({ frequency, weekdays })
  }

  const toggleWeekday = (day: number) => {
    const selected = settings.weekdays.includes(day)
    if (selected && settings.weekdays.length === 1) {
      onNotify('至少要保留一天提醒，或直接关闭提醒', 'error')
      return
    }
    const weekdays = selected
      ? settings.weekdays.filter((item) => item !== day)
      : [...settings.weekdays, day].sort((left, right) => left - right)
    update({ weekdays })
  }

  const handleTime = (time: string) => {
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) return
    update({ time })
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const result = await sendTestReminder()
      onNotify(result.message, result.ok ? 'success' : 'error')
      setPermission(await getReminderPermission())
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="settings-section reminder-section">
      <div className="settings-heading">
        <h3>记账提醒</h3>
        <p>
          到点时轻轻提醒一句，把当天的收支补上。默认每天 21:00；时间、频率都可以改，也可以随时关掉。
        </p>
      </div>

      <div className={`reminder-panel${settings.enabled ? '' : ' is-off'}`}>
        <div className="reminder-master">
          <span className="reminder-master-icon" aria-hidden="true">
            <BellRing size={20} strokeWidth={1.8} />
          </span>
          <span className="reminder-master-copy">
            <strong>开启记账提醒</strong>
            <small>
              {settings.enabled
                ? `下一次提醒：${describeNextReminder(settings, now)}`
                : '提醒已关闭，不会发送任何通知'}
            </small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            aria-label="开启记账提醒"
            className={`reminder-switch${settings.enabled ? ' is-on' : ''}`}
            onClick={() => void handleToggle()}
          >
            <span />
          </button>
        </div>

        <div className="reminder-controls">
          <label className="reminder-field">
            <span className="reminder-field-label">
              <Clock3 size={15} />
              提醒时间
            </span>
            <input
              type="time"
              value={settings.time}
              disabled={!settings.enabled}
              onChange={(event) => handleTime(event.target.value)}
              aria-label="提醒时间"
            />
          </label>

          <div className="reminder-field">
            <span className="reminder-field-label">提醒频率</span>
            <div
              className="reminder-segment"
              role="radiogroup"
              aria-label="提醒频率"
            >
              {FREQUENCIES.map((item) => {
                const active = settings.frequency === item.id
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={active ? 'is-active' : ''}
                    disabled={!settings.enabled}
                    onClick={() => handleFrequency(item.id)}
                  >
                    {item.label}
                  </button>
                )
              })}
            </div>
          </div>

          {settings.frequency === 'custom' ? (
            <div className="reminder-field reminder-field--wide">
              <span className="reminder-field-label">选择星期</span>
              <div className="reminder-days" role="group" aria-label="提醒星期">
                {WEEKDAY_CHIPS.map((label, day) => {
                  const active = settings.weekdays.includes(day)
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={active}
                      aria-label={`周${label}`}
                      className={active ? 'is-active' : ''}
                      disabled={!settings.enabled}
                      onClick={() => toggleWeekday(day)}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
              <p className="reminder-note">
                已选{' '}
                {activeWeekdays(settings)
                  .map((day) => `周${WEEKDAY_CHIPS[day]}`)
                  .join('、')}
                ，至少保留一天。
              </p>
            </div>
          ) : null}

          {desktop ? (
            <div className="reminder-field reminder-field--wide">
              <div className="reminder-inline-row">
                <span className="reminder-field-label">
                  <MonitorDown size={15} />
                  开机自启并最小化到托盘
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.autoStart}
                  aria-label="开机自启并最小化到托盘"
                  className={`reminder-switch reminder-switch--small${
                    settings.autoStart ? ' is-on' : ''
                  }`}
                  onClick={() => update({ autoStart: !settings.autoStart })}
                >
                  <span />
                </button>
              </div>
              <p className="reminder-note">
                开机后账页在托盘里安静运行，到点照常提醒；点托盘图标可以随时打开主窗口。
              </p>
            </div>
          ) : null}

          <div className="reminder-field reminder-field--wide">
            <div className="reminder-inline-row">
              <span className="reminder-field-label">通知权限</span>
              <button
                type="button"
                className="button ghost reminder-test"
                disabled={testing}
                onClick={() => void handleTest()}
              >
                <Send size={14} />
                {testing ? '发送中…' : '发送测试提醒'}
              </button>
            </div>
            <p
              className={`reminder-permission is-${permission}`}
              role="status"
            >
              {permission === 'granted' ? (
                <CheckCircle2 size={14} />
              ) : (
                <AlertCircle size={14} />
              )}
              {PERMISSION_COPY[permission]}
            </p>
            {desktop ? (
              <p className="reminder-note">
                Windows 的通知开关由系统统一管理，安装后默认允许，账页不会也无法弹出授权窗口；若收不到提醒，请到「设置 › 系统 › 通知」检查账页是否被关闭。
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  )
}
