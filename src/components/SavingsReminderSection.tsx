import { useEffect, useState } from 'react'
import { BellRing, Clock3, Send } from 'lucide-react'
import type { SavingsReminderSettings } from '../types'
import { isMobileApp } from '../lib/platform'
import {
  getReminderPermission,
  requestReminderPermission,
  sendTestSavingsReminder,
} from '../lib/reminderChannels'
import type { ReminderPermission } from '../lib/reminderChannels'

const PERMISSION_COPY: Record<ReminderPermission, string> = {
  granted: '系统通知已开启',
  denied: '系统通知被关闭，到期提醒无法送达，请在系统设置中允许账页通知',
  prompt: '首次开启时会向系统申请通知权限',
  unsupported: '当前环境不支持系统通知，提醒只在应用内生效',
}

interface SavingsReminderSectionProps {
  settings: SavingsReminderSettings
  onChange: (settings: SavingsReminderSettings) => void
  onNotify: (message: string, kind: 'success' | 'error') => void
}

export function SavingsReminderSection({
  settings,
  onChange,
  onNotify,
}: SavingsReminderSectionProps) {
  const [permission, setPermission] = useState<ReminderPermission>('prompt')
  const [testing, setTesting] = useState(false)

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

  const update = (patch: Partial<SavingsReminderSettings>) => {
    onChange({ ...settings, ...patch })
  }

  const handleToggle = async () => {
    const enabled = !settings.enabled
    update({ enabled })
    if (!enabled) return
    // The App-level scheduler applies the real holdings; here we only ask for
    // the permission at the moment of the click.
    await requestReminderPermission().catch(() => undefined)
    const nextPermission = await getReminderPermission()
    setPermission(nextPermission)
    if (nextPermission !== 'granted') {
      onNotify(
        isMobileApp()
          ? '通知权限还没有开启，提醒暂时无法送达；请在系统设置里允许账页通知。'
          : '通知权限还没有开启，提醒暂时无法送达。',
        'error',
      )
    }
  }

  const handleTest = async () => {
    setTesting(true)
    try {
      const result = await sendTestSavingsReminder()
      onNotify(result.message, result.ok ? 'success' : 'error')
      setPermission(await getReminderPermission())
    } finally {
      setTesting(false)
    }
  }

  return (
    <section className="settings-section reminder-section savings-reminder-section">
      <div className="settings-heading">
        <h3>储蓄到期提醒</h3>
        <p>
          只对还在存续、填写了到期日的储蓄生效。到期前 3 天和到期当天各提醒一次，
          已到期未处理的存单会一直显示在资债页，但不会重复推送。
        </p>
      </div>

      <div className={`reminder-panel${settings.enabled ? '' : ' is-off'}`}>
        <div className="reminder-master">
          <span className="reminder-master-icon" aria-hidden="true">
            <BellRing size={20} strokeWidth={1.8} />
          </span>
          <span className="reminder-master-copy">
            <strong>开启储蓄到期提醒</strong>
            <small>
              {settings.enabled
                ? `每天 ${settings.time} 检查到期日；到期前 3 天和当天各提醒一次`
                : '提醒已关闭，不会发送任何通知'}
            </small>
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={settings.enabled}
            aria-label="开启储蓄到期提醒"
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
              onChange={(event) => {
                if (
                  !/^([01]\d|2[0-3]):([0-5]\d)$/.test(event.target.value)
                ) {
                  return
                }
                update({ time: event.target.value })
              }}
              aria-label="储蓄到期提醒时间"
            />
          </label>

          <div className="reminder-field reminder-field--wide">
            <div className="reminder-inline-row">
              <span className="reminder-field-label">通知权限</span>
              <button
                type="button"
                className="button ghost reminder-test"
                disabled={testing || !settings.enabled}
                onClick={() => void handleTest()}
              >
                <Send size={14} />
                {testing ? '发送中…' : '发送测试提醒'}
              </button>
            </div>
            <p className={`reminder-permission is-${permission}`} role="status">
              {PERMISSION_COPY[permission]}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}
