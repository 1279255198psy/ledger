import type { Account, AccountType } from '../types'

/** Banks offered when adding a card. Custom names are always allowed too. */
export const BANK_PRESETS = [
  '工商银行',
  '建设银行',
  '农业银行',
  '中国银行',
  '交通银行',
  '招商银行',
  '邮储银行',
  '中信银行',
  '浦发银行',
  '民生银行',
  '兴业银行',
  '光大银行',
  '平安银行',
  '华夏银行',
  '广发银行',
  '北京银行',
  '上海银行',
  '农商银行',
] as const

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  wechat: '微信',
  alipay: '支付宝',
  cash: '现金',
  bank: '银行卡',
}

/**
 * The built-in wallet accounts. Only bank cards can be added, renamed or
 * removed; WeChat, Alipay and cash stay as stable everyday choices.
 */
export const DEFAULT_ACCOUNTS: Account[] = [
  { id: 'wechat', name: '微信', type: 'wechat' },
  { id: 'alipay', name: '支付宝', type: 'alipay' },
  { id: 'bank', name: '银行卡', type: 'bank' },
  { id: 'cash', name: '现金', type: 'cash' },
]

const LEGACY_TYPES: Record<string, AccountType> = {
  wechat: 'wechat',
  alipay: 'alipay',
  bank: 'bank',
  cash: 'cash',
}

/** Accounts live in module state so rows can label themselves without props. */
let activeAccounts: Account[] = DEFAULT_ACCOUNTS

export function setActiveAccounts(accounts: Account[]): void {
  activeAccounts = accounts.length > 0 ? accounts : DEFAULT_ACCOUNTS
}

export function getActiveAccounts(): Account[] {
  return activeAccounts
}

/**
 * Never returns undefined: old transactions can point at a card that has since
 * been removed, and the row still needs a readable label.
 */
export function getAccount(id: string): Account {
  return (
    activeAccounts.find((account) => account.id === id) ?? {
      id,
      name: '未知账户',
      type: 'bank',
    }
  )
}

export function isBuiltinAccount(account: Account): boolean {
  return account.type !== 'bank'
}

/** The everyday account a fresh entry starts on. */
export function getDefaultAccountId(accounts: Account[]): string {
  return (
    accounts.find((account) => account.type === 'wechat')?.id ??
    accounts[0]?.id ??
    'wechat'
  )
}

export function newAccountId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return `bank-${crypto.randomUUID()}`
  }
  return `bank-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

/**
 * Keeps card names apart. The first card keeps the plain bank name; the next
 * duplicate becomes「招商银行 2」, then「招商银行 3」, and so on.
 */
export function uniqueAccountName(
  name: string,
  accounts: Account[],
  exceptId?: string,
): string {
  const base = name.trim()
  if (!base) return base
  const taken = new Set(
    accounts
      .filter((account) => account.id !== exceptId)
      .map((account) => account.name),
  )
  if (!taken.has(base)) return base
  let index = 2
  while (taken.has(`${base} ${index}`)) index += 1
  return `${base} ${index}`
}

/**
 * Adds any cards the sample ledger needs without renaming existing ones. New
 * cards still go through the duplicate-name rule, so loading the sample never
 * leaves two cards with the same label.
 */
export function mergeAccounts(
  current: Account[],
  required: Account[],
): Account[] {
  const ids = new Set(current.map((account) => account.id))
  const additions: Account[] = []
  for (const account of required) {
    if (ids.has(account.id)) continue
    ids.add(account.id)
    additions.push({
      ...account,
      name: uniqueAccountName(account.name, [...current, ...additions]),
    })
  }
  return additions.length > 0 ? [...current, ...additions] : current
}

function normalizeAccount(value: unknown): Account | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (
    typeof item.id !== 'string' ||
    item.id.length === 0 ||
    item.id.length > 80 ||
    typeof item.name !== 'string' ||
    item.name.trim().length === 0 ||
    item.name.trim().length > 24
  ) {
    return null
  }
  const type: AccountType =
    item.type === 'wechat' ||
    item.type === 'alipay' ||
    item.type === 'cash' ||
    item.type === 'bank'
      ? item.type
      : (LEGACY_TYPES[item.id] ?? 'bank')
  if (type !== 'bank' && LEGACY_TYPES[item.id] !== type) {
    // The three wallet accounts keep their identity; a stored type cannot
    // turn 微信 into a bank card.
    return null
  }
  if (
    item.bank !== undefined &&
    (typeof item.bank !== 'string' || item.bank.trim().length > 24)
  ) {
    return null
  }

  return {
    id: item.id,
    name: item.name.trim(),
    type,
    ...(typeof item.bank === 'string' && item.bank.trim()
      ? { bank: item.bank.trim() }
      : {}),
  }
}

/**
 * Validates a stored account list. Returns null when the shape is unusable so
 * the caller can fall back to the built-in wallets instead of losing the app.
 */
export function normalizeAccounts(value: unknown): Account[] | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const ids = new Set<string>()
  const accounts: Account[] = []
  for (const entry of value) {
    const account = normalizeAccount(entry)
    if (!account || ids.has(account.id)) return null
    ids.add(account.id)
    accounts.push(account)
  }
  return accounts
}

export function isValidAccount(value: unknown): value is Account {
  return normalizeAccount(value) !== null
}
