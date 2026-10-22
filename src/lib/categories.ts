import type { Category, TransactionType } from '../types'

export interface CategoryDraft {
  type: TransactionType
  name: string
  color: string
  icon: string
}

/**
 * Curated colors that read well on both the light paper and the dark page.
 * Built-in categories without a color use the theme-aware tone palette below.
 */
export const CATEGORY_COLORS = [
  '#a94f35',
  '#b07a2a',
  '#657339',
  '#2c664d',
  '#326f91',
  '#57549a',
  '#82506f',
  '#a04b5f',
  '#6f6c63',
  '#8a5a3b',
  '#3d8a7a',
  '#7b6bb0',
]

export const DEFAULT_CATEGORY_TONES: Record<string, string> = {
  food: 'clay',
  transport: 'sky',
  shopping: 'plum',
  housing: 'olive',
  entertainment: 'amber',
  medical: 'rose',
  education: 'indigo',
  other_expense: 'stone',
  salary: 'forest',
  bonus: 'gold',
  investment: 'teal',
  freelance: 'sky',
  gift: 'rose',
  other_income: 'stone',
}

/** Light-theme tone values used as the starting point when editing a color. */
const TONE_HEX: Record<string, string> = {
  clay: '#a94f35',
  sky: '#326f91',
  plum: '#82506f',
  olive: '#657339',
  amber: '#936619',
  rose: '#a04b5f',
  indigo: '#57549a',
  stone: '#6f6c63',
  forest: '#2c664d',
  gold: '#8c6a1e',
  teal: '#266d65',
}

export const DEFAULT_EXPENSE_CATEGORIES: Category[] = [
  { id: 'food', name: '餐饮', type: 'expense', icon: 'utensils' },
  { id: 'transport', name: '交通', type: 'expense', icon: 'bus' },
  { id: 'shopping', name: '购物', type: 'expense', icon: 'shopping' },
  { id: 'housing', name: '居住', type: 'expense', icon: 'house' },
  { id: 'entertainment', name: '娱乐', type: 'expense', icon: 'gamepad' },
  { id: 'medical', name: '医疗', type: 'expense', icon: 'stethoscope' },
  { id: 'education', name: '教育', type: 'expense', icon: 'graduation' },
  { id: 'other_expense', name: '其他', type: 'expense', icon: 'shapes' },
]

export const DEFAULT_INCOME_CATEGORIES: Category[] = [
  { id: 'salary', name: '工资', type: 'income', icon: 'briefcase' },
  { id: 'bonus', name: '奖金', type: 'income', icon: 'award' },
  { id: 'investment', name: '理财', type: 'income', icon: 'trend' },
  { id: 'freelance', name: '兼职', type: 'income', icon: 'laptop' },
  { id: 'gift', name: '红包', type: 'income', icon: 'gift' },
  { id: 'other_income', name: '其他', type: 'income', icon: 'ellipsis' },
]

export const DEFAULT_CATEGORIES: Category[] = [
  ...DEFAULT_EXPENSE_CATEGORIES,
  ...DEFAULT_INCOME_CATEGORIES,
]

// Categories are read from lists rendered all over the app (rows, charts,
// filters). Like the active currency, the current list lives in module state
// and is kept in sync by App so lookups never need a prop on every component.
let activeCategories: Category[] = DEFAULT_CATEGORIES

export function setActiveCategories(categories: Category[]): void {
  activeCategories = categories
}

export function getActiveCategories(): Category[] {
  return activeCategories
}

export function getCategoriesForType(type: TransactionType): Category[] {
  return activeCategories.filter((category) => category.type === type)
}

/**
 * Never returns undefined: rows can outlive a category (for example a backup
 * referencing an id the current ledger no longer has) and still need a label.
 */
export function getCategory(
  id: string,
  type: TransactionType = 'expense',
): Category {
  const found = activeCategories.find((category) => category.id === id)
  if (found) return found
  return {
    id,
    name: '未分类',
    type,
    icon: type === 'income' ? 'ellipsis' : 'shapes',
  }
}

export function categoryTone(id: string): string {
  return DEFAULT_CATEGORY_TONES[id] ?? 'stone'
}

export function categoryColor(category: Category): string {
  if (category.color) return category.color
  return TONE_HEX[categoryTone(category.id)] ?? '#6f6c63'
}

export function defaultCategoryColor(index: number): string {
  return CATEGORY_COLORS[index % CATEGORY_COLORS.length]
}

export function newCategoryId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `cat-${crypto.randomUUID()}`
  }
  return `cat-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function isValidCategory(value: unknown): value is Category {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<Category>
  return (
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    item.id.length <= 80 &&
    typeof item.name === 'string' &&
    item.name.trim().length > 0 &&
    item.name.trim().length <= 20 &&
    (item.type === 'expense' || item.type === 'income') &&
    (item.color === undefined ||
      (typeof item.color === 'string' &&
        /^#[0-9a-fA-F]{6}$/.test(item.color))) &&
    (item.icon === undefined ||
      (typeof item.icon === 'string' && item.icon.length <= 40))
  )
}

/**
 * Validates a stored category list. Returns null (rather than throwing) so the
 * caller can fall back to the built-in list without losing the ledger.
 */
export function normalizeCategories(value: unknown): Category[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  if (!value.every(isValidCategory)) return null

  const ids = new Set<string>()
  for (const category of value) {
    if (ids.has(category.id)) return null
    ids.add(category.id)
  }
  // Both sides of the ledger need at least one category to record against.
  if (
    !value.some((category) => category.type === 'expense') ||
    !value.some((category) => category.type === 'income')
  ) {
    return null
  }

  return value.map((category) => ({
    ...category,
    name: category.name.trim(),
  }))
}
