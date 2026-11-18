import type { FocusEvent } from 'react'

interface DateInputProps {
  value: string
  onChange?: (value: string) => void
  min?: string
  max?: string
  disabled?: boolean
  ariaLabel?: string
  placeholder?: string
  className?: string
  onFocus?: (event: FocusEvent<HTMLInputElement>) => void
}

/**
 * A date field that never shows Chromium's locale-dependent `yyyy/mm/dd`
 * placeholder. The native input stays underneath for the real picker and
 * keyboard editing; the visible text is ours and uses ISO dates.
 */
export function DateInput({
  value,
  onChange,
  min,
  max,
  disabled = false,
  ariaLabel,
  placeholder = '选择日期',
  className = '',
  onFocus,
}: DateInputProps) {
  return (
    <span
      className={`date-input${value ? '' : ' is-empty'}${
        disabled ? ' is-disabled' : ''
      }${className ? ` ${className}` : ''}`}
    >
      <input
        type="date"
        value={value}
        min={min}
        max={max}
        disabled={disabled}
        aria-label={ariaLabel}
        onFocus={onFocus}
        onChange={(event) => onChange?.(event.target.value)}
      />
      <span className="date-input-display" aria-hidden="true">
        {value || (disabled ? '' : placeholder)}
      </span>
    </span>
  )
}
