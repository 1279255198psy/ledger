import type { Palette, Theme } from '../types'

export interface PalettePreview {
  page: string
  surface: string
  accent: string
  soft: string
  ink: string
  hero: string
  on: string
  income: string
  expense: string
  trend: string
}

export interface PaletteMeta {
  id: Palette
  name: string
  caption: string
  preview: Record<Theme, PalettePreview>
  themeColor: Record<Theme, string>
}

export const PALETTES: PaletteMeta[] = [
  {
    id: 'forest',
    name: '松烟绿',
    caption: 'PINE SOOT',
    preview: {
      light: {
        page: '#f3f0e7',
        surface: '#fffcf6',
        accent: '#234d3b',
        soft: '#e3ece4',
        ink: '#1e241f',
        hero: '#203b2f',
        on: '#f8f4e9',
        income: '#157a5a',
        expense: '#b0482f',
        trend: '#0f7350',
      },
      dark: {
        page: '#10130f',
        surface: '#1a1e19',
        accent: '#9fc2ae',
        soft: '#29382e',
        ink: '#ece9df',
        hero: '#1b3428',
        on: '#15251b',
        income: '#3fa07f',
        expense: '#cf7160',
        trend: '#1f8f6f',
      },
    },
    themeColor: { light: '#f3f0e7', dark: '#10130f' },
  },
  {
    id: 'gold',
    name: '琥珀金',
    caption: 'AMBER GILT',
    preview: {
      light: {
        page: '#f4f0e6',
        surface: '#fffcf5',
        accent: '#7c5a22',
        soft: '#f1e6ce',
        ink: '#221f19',
        hero: '#2b2418',
        on: '#fbf6e9',
        income: '#00846c',
        expense: '#a8552f',
        trend: '#8a6214',
      },
      dark: {
        page: '#111110',
        surface: '#1c1a17',
        accent: '#d2b274',
        soft: '#2e281e',
        ink: '#ede7da',
        hero: '#201b13',
        on: '#1c1710',
        income: '#33a696',
        expense: '#cf7a4e',
        trend: '#b08a2f',
      },
    },
    themeColor: { light: '#f4f0e6', dark: '#111110' },
  },
  {
    id: 'navy',
    name: '远山蓝',
    caption: 'DISTANT HILLS',
    preview: {
      light: {
        page: '#f2f0ea',
        surface: '#fcfbf7',
        accent: '#1e3a52',
        soft: '#e2e9ee',
        ink: '#1d2227',
        hero: '#16283a',
        on: '#f7f4ec',
        income: '#2a6fa8',
        expense: '#a34d5c',
        trend: '#30568f',
      },
      dark: {
        page: '#0e1216',
        surface: '#171c21',
        accent: '#a8c2d8',
        soft: '#1f2b34',
        ink: '#e8e8e3',
        hero: '#132436',
        on: '#0e1720',
        income: '#4f8fc9',
        expense: '#c76f80',
        trend: '#4f7fb8',
      },
    },
    themeColor: { light: '#f2f0ea', dark: '#0e1216' },
  },
  {
    id: 'rose',
    name: '玫瑰紫',
    caption: 'ROSE VIOLET',
    preview: {
      light: {
        page: '#f5f0f4',
        surface: '#fdfafc',
        accent: '#6b3a5b',
        soft: '#f1e2eb',
        ink: '#241f26',
        hero: '#2c1f2c',
        on: '#fbf5f9',
        income: '#5c408e',
        expense: '#9c3a43',
        trend: '#8a4b7a',
      },
      dark: {
        page: '#141017',
        surface: '#1e1821',
        accent: '#d2a6c4',
        soft: '#332433',
        ink: '#ece4eb',
        hero: '#2a1c2b',
        on: '#1b121c',
        income: '#8f78d0',
        expense: '#d1747f',
        trend: '#b07ac0',
      },
    },
    themeColor: { light: '#f5f0f4', dark: '#141017' },
  },
]

export const DEFAULT_PALETTE: Palette = 'forest'

export function isPalette(value: unknown): value is Palette {
  return (
    value === 'forest' ||
    value === 'gold' ||
    value === 'navy' ||
    value === 'rose'
  )
}

export function normalizePalette(value: unknown): Palette {
  if (value === 'copper') return 'rose'
  return isPalette(value) ? value : DEFAULT_PALETTE
}

export function paletteThemeColor(
  palette: Palette,
  theme: Theme,
): string {
  const meta = PALETTES.find((item) => item.id === palette) ?? PALETTES[0]
  return meta.themeColor[theme]
}
