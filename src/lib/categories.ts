import type { Category, TransactionType } from '../types'

export interface CategoryDraft {
  type: TransactionType
  name: string
  color: string
  icon: string
  parentId?: string
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

/** Ready-made subcategories. They inherit their parent's color. */
export const PRESET_EXPENSE_SUBCATEGORIES: Category[] = [
  { id: 'food-meal', name: '吃饭开销', type: 'expense', parentId: 'food', icon: 'utensils' },
  { id: 'food-drink', name: '饮料奶茶', type: 'expense', parentId: 'food', icon: 'coffee' },
  { id: 'food-snack', name: '零食水果', type: 'expense', parentId: 'food', icon: 'leaf' },
  { id: 'transport-metro', name: '公交地铁', type: 'expense', parentId: 'transport', icon: 'bus' },
  { id: 'transport-taxi', name: '打车', type: 'expense', parentId: 'transport', icon: 'car' },
  { id: 'transport-fuel', name: '加油停车', type: 'expense', parentId: 'transport', icon: 'wrench' },
  { id: 'shopping-daily', name: '日用品', type: 'expense', parentId: 'shopping', icon: 'shopping' },
  { id: 'shopping-clothes', name: '衣物鞋包', type: 'expense', parentId: 'shopping', icon: 'shopping' },
  { id: 'shopping-digital', name: '数码家电', type: 'expense', parentId: 'shopping', icon: 'smartphone' },
  { id: 'housing-rent', name: '房租房贷', type: 'expense', parentId: 'housing', icon: 'house' },
  { id: 'housing-utilities', name: '水电燃气', type: 'expense', parentId: 'housing', icon: 'receipt' },
  { id: 'housing-repair', name: '物业维修', type: 'expense', parentId: 'housing', icon: 'wrench' },
  { id: 'entertainment-movie', name: '电影演出', type: 'expense', parentId: 'entertainment', icon: 'clapperboard' },
  { id: 'entertainment-game', name: '游戏订阅', type: 'expense', parentId: 'entertainment', icon: 'gamepad' },
  { id: 'entertainment-travel', name: '旅行度假', type: 'expense', parentId: 'entertainment', icon: 'plane' },
  { id: 'medical-clinic', name: '门诊买药', type: 'expense', parentId: 'medical', icon: 'stethoscope' },
  { id: 'medical-checkup', name: '体检保健', type: 'expense', parentId: 'medical', icon: 'heart' },
  { id: 'education-course', name: '课程培训', type: 'expense', parentId: 'education', icon: 'graduation' },
  { id: 'education-books', name: '书籍文具', type: 'expense', parentId: 'education', icon: 'book' },
]

export const PRESET_INCOME_SUBCATEGORIES: Category[] = [
  { id: 'salary-base', name: '基本工资', type: 'income', parentId: 'salary', icon: 'briefcase' },
  { id: 'salary-overtime', name: '加班补贴', type: 'income', parentId: 'salary', icon: 'banknote' },
  { id: 'bonus-year', name: '年终奖', type: 'income', parentId: 'bonus', icon: 'award' },
  { id: 'bonus-performance', name: '绩效奖金', type: 'income', parentId: 'bonus', icon: 'trend' },
  { id: 'investment-interest', name: '利息', type: 'income', parentId: 'investment', icon: 'piggy' },
  { id: 'investment-dividend', name: '分红', type: 'income', parentId: 'investment', icon: 'trend' },
  { id: 'freelance-gig', name: '外快', type: 'income', parentId: 'freelance', icon: 'laptop' },
  { id: 'gift-cash', name: '礼金', type: 'income', parentId: 'gift', icon: 'gift' },
]

export const PRESET_SUBCATEGORIES: Category[] = [
  ...PRESET_EXPENSE_SUBCATEGORIES,
  ...PRESET_INCOME_SUBCATEGORIES,
]

export const DEFAULT_CATEGORIES: Category[] = [
  ...DEFAULT_EXPENSE_CATEGORIES,
  ...PRESET_EXPENSE_SUBCATEGORIES,
  ...DEFAULT_INCOME_CATEGORIES,
  ...PRESET_INCOME_SUBCATEGORIES,
]

/**
 * Adds the ready-made subcategories that are still missing. Used once when an
 * older ledger is upgraded; a marker prevents deleted presets from returning.
 */
export function withPresetSubcategories(categories: Category[]): Category[] {
  const existingIds = new Set(categories.map((category) => category.id))
  const additions = PRESET_SUBCATEGORIES.filter((subcategory) => {
    if (existingIds.has(subcategory.id)) return false
    const parent = categories.find(
      (category) => category.id === subcategory.parentId,
    )
    return Boolean(
      parent && parent.type === subcategory.type && !parent.parentId,
    )
  })
  return additions.length > 0 ? [...categories, ...additions] : categories
}

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

export function getTopLevelCategories(type: TransactionType): Category[] {
  return activeCategories.filter(
    (category) => category.type === type && !category.parentId,
  )
}

export function getSubcategories(parentId: string): Category[] {
  return activeCategories.filter(
    (category) => category.parentId === parentId,
  )
}

export interface CategoryNode {
  category: Category
  children: Category[]
}

/** One level of nesting: every top-level category with its subcategories. */
export function getCategoryTree(type: TransactionType): CategoryNode[] {
  return getTopLevelCategories(type).map((category) => ({
    category,
    children: getSubcategories(category.id),
  }))
}

export function getParentCategory(
  category: Category,
): Category | undefined {
  if (!category.parentId) return undefined
  return activeCategories.find(
    (item) => item.id === category.parentId,
  )
}

/** The top-level category used for totals and filters. */
export function getRootCategoryId(id: string): string {
  const category = activeCategories.find((item) => item.id === id)
  return category?.parentId ?? id
}

/** Full name for a subcategory, e.g. 「餐饮 · 饮料奶茶」. */
export function getCategoryPathName(category: Category): string {
  const parent = getParentCategory(category)
  return parent ? `${parent.name} · ${category.name}` : category.name
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

/**
 * A custom color that should override the theme tone. Subcategories without
 * their own color inherit the one chosen for their parent.
 */
export function categoryCustomColor(
  category: Category,
): string | undefined {
  if (category.color) return category.color
  return getParentCategory(category)?.color
}

/** Theme tone key, inherited from the parent for subcategories. */
export function categoryToneKey(category: Category): string {
  const parent = getParentCategory(category)
  return categoryTone(parent?.id ?? category.id)
}

export function categoryColor(category: Category): string {
  const custom = categoryCustomColor(category)
  if (custom) return custom
  return TONE_HEX[categoryToneKey(category)] ?? '#6f6c63'
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
      (typeof item.icon === 'string' && item.icon.length <= 40)) &&
    (item.parentId === undefined ||
      (typeof item.parentId === 'string' &&
        item.parentId.length > 0 &&
        item.parentId.length <= 80))
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
  // Subcategories are one level deep, share their parent's type, and may not
  // point at another subcategory.
  const byId = new Map(value.map((category) => [category.id, category]))
  for (const category of value) {
    if (!category.parentId) continue
    if (category.parentId === category.id) return null
    const parent = byId.get(category.parentId)
    if (
      !parent ||
      parent.type !== category.type ||
      Boolean(parent.parentId)
    ) {
      return null
    }
  }
  // Both sides of the ledger need at least one top-level category.
  if (
    !value.some((category) => category.type === 'expense' && !category.parentId) ||
    !value.some((category) => category.type === 'income' && !category.parentId)
  ) {
    return null
  }

  return value.map((category) => ({
    ...category,
    name: category.name.trim(),
  }))
}
