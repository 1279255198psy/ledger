import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  /** Optional section heading rendered before the first option of a group. */
  group?: string
}

interface SelectMenuProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  ariaLabel: string
  placeholder?: string
  icon?: ReactNode
  className?: string
  /** Lift the panel above a modal backdrop (z-index 100). */
  elevated?: boolean
  /** Adds a leading option that clears the filter. */
  allLabel?: string
  footer?: string
  disabled?: boolean
}

interface PopoverPosition {
  left: number
  top: number
  width: number
  maxHeight: number
}

function measureMenu(
  trigger: HTMLElement | null,
  optionCount: number,
): PopoverPosition | null {
  const rect = trigger?.getBoundingClientRect()
  if (!rect) return null
  const gutter = 12
  const width = Math.min(260, window.innerWidth - gutter * 2)
  const left = Math.min(
    Math.max(gutter, rect.left),
    window.innerWidth - width - gutter,
  )
  const spaceBelow = window.innerHeight - rect.bottom - gutter
  const spaceAbove = rect.top - gutter
  const openUp = spaceBelow < 180 && spaceAbove > spaceBelow
  const estimatedHeight = Math.min(
    340,
    12 + optionCount * 33 + (optionCount > 2 ? 24 : 0),
  )
  const available = Math.max(140, openUp ? spaceAbove : spaceBelow)
  const maxHeight = Math.min(estimatedHeight, available)
  const top = openUp
    ? Math.max(gutter, rect.top - maxHeight - 7)
    : rect.bottom + 7
  return { left, top, width, maxHeight }
}

/**
 * The shared account/filter dropdown. It mirrors the flow page's popover so
 * the entry form, the flow filter and the sync prompt all read the same.
 */
export function SelectMenu({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = '请选择',
  icon,
  className = '',
  elevated = false,
  allLabel,
  footer,
  disabled = false,
}: SelectMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState<PopoverPosition | null>(null)

  const selected = options.find((option) => option.value === value)
  const label =
    value === '' && allLabel
      ? allLabel
      : (selected?.label ?? placeholder)
  const optionCount = options.length + (allLabel ? 1 : 0)

  const reposition = () => {
    setPosition(
      measureMenu(rootRef.current?.querySelector('button') ?? null, optionCount),
    )
  }

  const toggle = () => {
    if (disabled) return
    setOpen((current) => {
      const next = !current
      if (next) reposition()
      return next
    })
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        !rootRef.current?.contains(target) &&
        !popoverRef.current?.contains(target)
      ) {
        setOpen(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      // Capture and stop here so an open modal does not also close.
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    const onViewportChange = () => reposition()
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('resize', onViewportChange)
    window.addEventListener('scroll', onViewportChange, true)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('resize', onViewportChange)
      window.removeEventListener('scroll', onViewportChange, true)
    }
  }, [open, optionCount])

  useEffect(() => {
    if (disabled) setOpen(false)
  }, [disabled])

  let lastGroup = ''

  return (
    <div
      className={`select-field category-filter${className ? ` ${className}` : ''}`}
      ref={rootRef}
    >
      {icon}
      <button
        type="button"
        className="category-filter-trigger"
        onClick={toggle}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${ariaLabel}：${label}`}
      >
        <span>{label}</span>
        <ChevronDown
          size={13}
          aria-hidden
          className={open ? 'is-open' : undefined}
        />
      </button>

      {open && position
        ? createPortal(
            <div
              className={`category-filter-popover${
                elevated ? ' is-elevated' : ''
              }`}
              role="dialog"
              aria-label={ariaLabel}
              ref={popoverRef}
              style={{
                left: position.left,
                top: position.top,
                width: position.width,
                maxHeight: position.maxHeight,
              }}
            >
              {allLabel ? (
                <button
                  type="button"
                  className={`category-filter-option category-filter-option--all${
                    value === '' ? ' is-selected' : ''
                  }`}
                  onClick={() => {
                    onChange('')
                    setOpen(false)
                  }}
                  aria-pressed={value === ''}
                >
                  <span>{allLabel}</span>
                  {value === '' ? (
                    <Check size={12} className="category-filter-check" />
                  ) : null}
                </button>
              ) : null}

              {options.map((option) => {
                const groupHeading =
                  option.group && option.group !== lastGroup ? option.group : ''
                lastGroup = option.group ?? lastGroup
                const isSelected = option.value === value
                return (
                  <div key={option.value}>
                    {groupHeading ? (
                      <p className="category-filter-label">{groupHeading}</p>
                    ) : null}
                    <button
                      type="button"
                      className={`category-filter-option${
                        isSelected ? ' is-selected' : ''
                      }`}
                      onClick={() => {
                        onChange(option.value)
                        setOpen(false)
                      }}
                      aria-pressed={isSelected}
                    >
                      <span>{option.label}</span>
                      {isSelected ? (
                        <Check size={12} className="category-filter-check" />
                      ) : null}
                    </button>
                  </div>
                )
              })}

              {footer ? (
                <p className="category-filter-hint">{footer}</p>
              ) : null}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
