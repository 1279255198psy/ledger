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
        income: '#0f6b96',
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
        income: '#3a94cc',
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
    id: 'copper',
    name: '曜石铜',
    caption: 'OBSIDIAN COPPER',
    preview: {
      light: {
        page: '#f1efea',
        surface: '#fcfaf6',
        accent: '#8a4b2b',
        soft: '#f3e4da',
        ink: '#1f1e1c',
        hero: '#262320',
        on: '#fbf5ee',
        income: '#0b7d62',
        expense: '#a34532',
        trend: '#8a431f',
      },
      dark: {
        page: '#111213',
        surface: '#1b1d1e',
        accent: '#c98f6b',
        soft: '#32251d',
        ink: '#e9e7e2',
        hero: '#1e2123',
        on: '#1a1512',
        income: '#2f9d84',
        expense: '#c96a55',
        trend: '#b0703f',
      },
    },
    themeColor: { light: '#f1efea', dark: '#111213' },
  },
]

export const DEFAULT_PALETTE: Palette = 'forest'

export function isPalette(value: unknown): value is Palette {
  return (
    value === 'forest' ||
    value === 'gold' ||
    value === 'navy' ||
    value === 'copper'
  )
}

export function paletteThemeColor(
  palette: Palette,
  theme: Theme,
): string {
  const meta = PALETTES.find((item) => item.id === palette) ?? PALETTES[0]
  return meta.themeColor[theme]
}
