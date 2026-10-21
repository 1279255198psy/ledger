import type { FontSize } from '../types'

export interface FontSizeOption {
  id: FontSize
  name: string
}

export const FONT_SIZES: FontSizeOption[] = [
  { id: 'small', name: '小' },
  { id: 'standard', name: '标准' },
  { id: 'large', name: '大' },
  { id: 'xlarge', name: '超大' },
]

export const DEFAULT_FONT_SIZE: FontSize = 'standard'

const FONT_SIZE_IDS = new Set<string>(FONT_SIZES.map((item) => item.id))

export function isFontSize(value: unknown): value is FontSize {
  return typeof value === 'string' && FONT_SIZE_IDS.has(value)
}

export function normalizeFontSize(value: unknown): FontSize {
  return isFontSize(value) ? value : DEFAULT_FONT_SIZE
}
