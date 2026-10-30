import type { Account, AccountType, Category } from '../../types'
import { normalizeHeader } from './csv'
import { accountTypeForName, matchCategory } from './plan'
import type {
  AccountChoice,
  AccountTarget,
  CategoryChoice,
  CategoryTarget,
  ColumnMapping,
  FieldKey,
  ImportTemplate,
} from './types'

const STORAGE_KEY = 'zhangye.import.templates.v1'

const FIELD_KEYS: FieldKey[] = [
  'date',
  'time',
  'direction',
  'amount',
  'expenseAmount',
  'incomeAmount',
  'category',
  'account',
  'note',
  'externalId',
  'status',
  'tags',
  'zhangye',
]

const ACCOUNT_TYPES: AccountType[] = ['wechat', 'alipay', 'cash', 'bank']

function newTemplateId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCategoryTarget(value: unknown): value is CategoryTarget {
  if (!isRecord(value)) return false
  if (value.kind === 'skip') return true
  if (value.kind === 'existing') {
    return typeof value.id === 'string' && value.id.length > 0
  }
  if (value.kind === 'create') {
    return (
      typeof value.name === 'string' &&
      value.name.length > 0 &&
      (value.parentId === undefined || typeof value.parentId === 'string')
    )
  }
  return false
}

function isAccountTarget(value: unknown): value is AccountTarget {
  if (!isRecord(value)) return false
  if (value.kind === 'skip') return true
  if (value.kind === 'existing') {
    return typeof value.id === 'string' && value.id.length > 0
  }
  if (value.kind === 'create') {
    return (
      typeof value.name === 'string' &&
      value.name.length > 0 &&
      ACCOUNT_TYPES.includes(value.type as AccountType)
    )
  }
  return false
}

function isMapping(value: unknown): value is ColumnMapping {
  if (!isRecord(value)) return false
  return Object.entries(value).every(
    ([key, cell]) =>
      FIELD_KEYS.includes(key as FieldKey) && typeof cell === 'string',
  )
}

function isTemplate(value: unknown): value is ImportTemplate {
  if (!isRecord(value)) return false
  if (
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    typeof value.sourceId !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) {
    return false
  }
  if (!isMapping(value.mapping)) return false
  if (!isRecord(value.categories) || !isRecord(value.accounts)) return false
  return (
    Object.values(value.categories).every(isCategoryTarget) &&
    Object.values(value.accounts).every(isAccountTarget)
  )
}

export function loadTemplates(): ImportTemplate[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(isTemplate)
      .slice(0, 50)
      .map((template) => ({
        ...template,
        name: template.name.trim().slice(0, 40) || '未命名模板',
      }))
  } catch {
    return []
  }
}

export function saveTemplates(templates: ImportTemplate[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(templates.slice(0, 50)),
    )
  } catch {
    // A full or unavailable localStorage only costs convenience.
  }
}

export interface TemplateInput {
  name: string
  sourceId: string
  mapping: ColumnMapping
  categoryChoices: CategoryChoice[]
  accountChoices: AccountChoice[]
  /** Reuse these when updating an existing template. */
  id?: string
  createdAt?: string
}

export function buildTemplate(input: TemplateInput): ImportTemplate {
  const now = new Date().toISOString()
  const mapping: ColumnMapping = {}
  for (const key of FIELD_KEYS) {
    const value = input.mapping[key]
    // Store unset fields as an explicit "do not use": re-applying the template
    // should reproduce the mapping, not let header detection add columns.
    mapping[key] = typeof value === 'string' ? value : ''
  }

  const categories: Record<string, CategoryTarget> = {}
  for (const choice of input.categoryChoices) {
    categories[choice.key] = { ...choice.target }
  }
  const accounts: Record<string, AccountTarget> = {}
  for (const choice of input.accountChoices) {
    accounts[choice.key] = { ...choice.target }
  }

  return {
    id: input.id ?? newTemplateId(),
    name: input.name.trim().slice(0, 40) || '未命名模板',
    sourceId: input.sourceId,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
    mapping,
    categories,
    accounts,
  }
}

/**
 * Replaces a template with the same id, or the same name, so repeatedly saving
 * under one name updates it instead of piling up duplicates.
 */
export function upsertTemplate(
  list: ImportTemplate[],
  template: ImportTemplate,
): { templates: ImportTemplate[]; saved: ImportTemplate } {
  const index = list.findIndex(
    (item) => item.id === template.id || item.name === template.name,
  )
  if (index < 0) {
    return { templates: [...list, template], saved: template }
  }
  const saved: ImportTemplate = {
    ...template,
    id: list[index].id,
    createdAt: list[index].createdAt,
  }
  const next = [...list]
  next[index] = saved
  return { templates: next, saved }
}

export function removeTemplate(
  list: ImportTemplate[],
  id: string,
): ImportTemplate[] {
  return list.filter((template) => template.id !== id)
}

/**
 * Keeps only the saved columns that still exist in the new file, and returns
 * the new file's spelling of each header so selects and parsers line up.
 */
export function mappingForHeaders(
  mapping: ColumnMapping,
  headers: string[],
): ColumnMapping {
  const actual = new Map<string, string>()
  for (const header of headers) actual.set(normalizeHeader(header), header)

  const result: ColumnMapping = {}
  for (const key of FIELD_KEYS) {
    const value = mapping[key]
    if (typeof value !== 'string') continue
    if (value === '') {
      result[key] = ''
      continue
    }
    const header = actual.get(normalizeHeader(value))
    if (header !== undefined) result[key] = header
  }
  return result
}

function resolveCategoryTarget(
  saved: CategoryTarget,
  choice: CategoryChoice,
  categories: Category[],
): CategoryTarget {
  if (saved.kind === 'skip') return saved
  if (saved.kind === 'existing') {
    const found = categories.find(
      (category) => category.id === saved.id && category.type === choice.type,
    )
    if (found) return saved
    // The category was deleted since the template was saved; re-suggest.
    return matchCategory(choice.sourceName, choice.type, categories)
  }

  const parentId =
    saved.parentId &&
    categories.some(
      (category) =>
        category.id === saved.parentId && category.type === choice.type,
    )
      ? saved.parentId
      : undefined
  return parentId
    ? { kind: 'create', name: saved.name, parentId }
    : { kind: 'create', name: saved.name }
}

function resolveAccountTarget(
  saved: AccountTarget,
  choice: AccountChoice,
  accounts: Account[],
): AccountTarget {
  if (saved.kind === 'skip') return saved
  if (saved.kind === 'existing') {
    if (accounts.some((account) => account.id === saved.id)) return saved
    const name = choice.sourceName || '现金'
    return {
      kind: 'create',
      name,
      type: accountTypeForName(name) ?? 'cash',
    }
  }
  return saved
}

/** Overlays a saved template on freshly suggested choices. */
export function applyCategoryTargets(
  choices: CategoryChoice[],
  targets: Record<string, CategoryTarget>,
  categories: Category[],
): CategoryChoice[] {
  return choices.map((choice) => {
    const saved = targets[choice.key]
    if (!saved) return choice
    return {
      ...choice,
      target: resolveCategoryTarget(saved, choice, categories),
    }
  })
}

export function applyAccountTargets(
  choices: AccountChoice[],
  targets: Record<string, AccountTarget>,
  accounts: Account[],
): AccountChoice[] {
  return choices.map((choice) => {
    const saved = targets[choice.key]
    if (!saved) return choice
    return {
      ...choice,
      target: resolveAccountTarget(saved, choice, accounts),
    }
  })
}
