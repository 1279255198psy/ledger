import type {
  Account,
  AccountType,
  Category,
  LedgerTransaction,
  TransactionType,
} from '../../types'
import { makeDailyAllocation } from '../allocations'
import { newCategoryId } from '../categories'
import { newTransactionId } from '../data'
import { newAccountId } from '../accounts'
import type {
  AccountChoice,
  AccountTarget,
  CategoryChoice,
  CategoryTarget,
  ExchangeRow,
  ImportContext,
  ImportOptions,
  ImportPlan,
} from './types'

function normalizeName(value: string): string {
  return value
    .replace(/\s+/g, '')
    .replace(/[·・\-—_/\\|:：,，.。]/g, '')
    .toLowerCase()
}

function cleanName(value: string, fallback: string): string {
  const cleaned = value
    .replace(/^[\s·・\-—_/\\|:：]+|[\s·・\-—_/\\|:：]+$/g, '')
    .replace(/\s+/g, ' ')
    .slice(0, 16)
  return cleaned || fallback
}

function otherCategoryId(type: TransactionType): string {
  return type === 'income' ? 'other_income' : 'other_expense'
}

function categoriesOfType(
  categories: Category[],
  type: TransactionType,
): Category[] {
  return categories.filter((category) => category.type === type)
}

function pathName(category: Category, categories: Category[]): string {
  if (!category.parentId) return category.name
  const parent = categories.find((item) => item.id === category.parentId)
  return parent ? `${parent.name}·${category.name}` : category.name
}

function lastSegment(value: string): string {
  const parts = value.split(/[/>·・|｜]/).map((part) => part.trim()).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : value
}

/** Finds an existing category by name or full path, never by fuzzy guessing. */
export function matchCategory(
  sourceName: string,
  type: TransactionType,
  categories: Category[],
): CategoryTarget {
  const list = categoriesOfType(categories, type)
  if (list.length === 0) {
    return { kind: 'create', name: cleanName(sourceName, '其他') }
  }

  const byId = new Map(list.map((category) => [category.id, category]))
  const wanted = normalizeName(sourceName)
  if (!wanted) {
    const fallback = byId.get(otherCategoryId(type)) ?? list[0]
    return { kind: 'existing', id: fallback.id }
  }

  const exact = list.find(
    (category) =>
      normalizeName(category.name) === wanted ||
      normalizeName(pathName(category, categories)) === wanted,
  )
  if (exact) return { kind: 'existing', id: exact.id }

  // 「餐饮/外卖」and「餐饮·外卖」both point at the 外卖 subcategory.
  const segment = lastSegment(sourceName)
  if (segment !== sourceName) {
    const bySegment = list.find(
      (category) => normalizeName(category.name) === normalizeName(segment),
    )
    if (bySegment) return { kind: 'existing', id: bySegment.id }
  }

  const byPath = list.find(
    (category) => normalizeName(pathName(category, categories)) === normalizeName(sourceName),
  )
  if (byPath) return { kind: 'existing', id: byPath.id }

  // 「餐饮/外卖」when only 「餐饮」exists: keep the hierarchy and create the
  // child under the matching top-level category.
  const parts = sourceName
    .split(/[/>·・|｜]/)
    .map((part) => part.trim())
    .filter(Boolean)
  if (parts.length > 1) {
    const parent = list.find(
      (category) =>
        !category.parentId &&
        normalizeName(category.name) === normalizeName(parts[0]),
    )
    if (parent) {
      return {
        kind: 'create',
        name: cleanName(parts[parts.length - 1], '其他'),
        parentId: parent.id,
      }
    }
  }

  return { kind: 'create', name: cleanName(segment, '其他') }
}

export function suggestCategoryChoices(
  rows: ExchangeRow[],
  categories: Category[],
): CategoryChoice[] {
  const counts = new Map<
    string,
    {
      type: TransactionType
      sourceName: string
      count: number
    }
  >()

  for (const row of rows) {
    if (row.direction === 'transfer' || row.direction === 'unknown') continue
    const type: TransactionType = row.direction === 'income' ? 'income' : 'expense'
    const sourceName = row.categoryName.trim()
    const key = `${type}|${sourceName}`
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { type, sourceName, count: 1 })
  }

  return [...counts.entries()]
    .map(([key, entry]) => ({
      key,
      type: entry.type,
      sourceName: entry.sourceName,
      count: entry.count,
      target: matchCategory(entry.sourceName, entry.type, categories),
    }))
    .sort((left, right) => {
      if (left.type !== right.type) return left.type === 'expense' ? -1 : 1
      if (right.count !== left.count) return right.count - left.count
      return left.sourceName.localeCompare(right.sourceName, 'zh')
    })
}

const ACCOUNT_KEYWORDS: Array<[RegExp, AccountType]> = [
  [/微信|零钱|财付通/, 'wechat'],
  [/支付宝|余额宝|花呗|蚂蚁/, 'alipay'],
  [/现金/, 'cash'],
  [/银行|储蓄卡|信用卡|借记卡|卡号|尾号/, 'bank'],
]

export function accountTypeForName(sourceName: string): AccountType | null {
  for (const [pattern, type] of ACCOUNT_KEYWORDS) {
    if (pattern.test(sourceName)) return type
  }
  return null
}

export function suggestAccountChoices(
  rows: ExchangeRow[],
  accounts: Account[],
  fallbackType: AccountType = 'cash',
): AccountChoice[] {
  const counts = new Map<string, { sourceName: string; count: number }>()
  for (const row of rows) {
    if (row.direction === 'transfer' || row.direction === 'unknown') continue
    const sourceName = row.accountName.trim()
    const key = normalizeName(sourceName) || '__default__'
    const entry = counts.get(key)
    if (entry) entry.count += 1
    else counts.set(key, { sourceName, count: 1 })
  }

  const fallback =
    accounts.find((account) => account.type === fallbackType) ?? accounts[0]

  return [...counts.entries()]
    .map(([key, entry]) => {
      const wanted = normalizeName(entry.sourceName)
      let target: AccountTarget | null = null

      if (wanted) {
        const exact = accounts.find(
          (account) => normalizeName(account.name) === wanted,
        )
        if (exact) target = { kind: 'existing', id: exact.id }

        if (!target) {
          const contained = accounts.find(
            (account) =>
              wanted.includes(normalizeName(account.name)) ||
              normalizeName(account.name).includes(wanted),
          )
          if (contained) target = { kind: 'existing', id: contained.id }
        }
      }

      if (!target) {
        const type = accountTypeForName(entry.sourceName) ?? fallbackType
        const sameType =
          accounts.find((account) => account.type === type) ?? fallback
        if (sameType) target = { kind: 'existing', id: sameType.id }
      }

      if (!target) {
        target = {
          kind: 'create',
          name: cleanName(entry.sourceName, '现金'),
          type: fallbackType,
        }
      }

      return {
        key,
        sourceName: entry.sourceName,
        count: entry.count,
        target,
      }
    })
    .sort((left, right) => right.count - left.count)
}

/** A compact, stable identity for a row that has no transaction number. */
export function transactionFingerprint(transaction: {
  date: string
  amountCents: number
  type: TransactionType
  accountId: string
  note: string
}): string {
  const note = transaction.note.replace(/\s+/g, '').toLowerCase()
  const text = `${transaction.date}|${transaction.amountCents}|${transaction.type}|${transaction.accountId}|${note}`
  let hash = 0x811c9dc5
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function resolveCategoryId(
  choice: CategoryChoice,
  created: Map<string, Category>,
  categories: Category[],
): string | null {
  const target = choice.target
  if (target.kind === 'skip') return null
  if (target.kind === 'existing') return target.id

  const name = cleanName(target.name, '其他')
  const existing = categories.find(
    (category) =>
      category.type === choice.type &&
      category.name === name &&
      (target.parentId ? category.parentId === target.parentId : true),
  )
  if (existing) return existing.id

  const key = `${choice.type}|${target.parentId ?? ''}|${name}`
  const cached = created.get(key)
  if (cached) return cached.id
  const category: Category = {
    id: newCategoryId(),
    name,
    type: choice.type,
    icon: choice.type === 'income' ? 'ellipsis' : 'shapes',
    ...(target.parentId ? { parentId: target.parentId } : {}),
  }
  created.set(key, category)
  return category.id
}

function resolveAccountId(
  choice: AccountChoice,
  created: Map<string, Account>,
  accounts: Account[],
): string | null {
  const target = choice.target
  if (target.kind === 'skip') return null
  if (target.kind === 'existing') return target.id

  const name = cleanName(target.name, '现金')
  const existing = accounts.find((account) => account.name === name)
  if (existing) return existing.id

  const cached = created.get(name)
  if (cached) return cached.id
  const account: Account = {
    id: newAccountId(),
    name,
    type: target.type,
  }
  created.set(name, account)
  return account.id
}

/**
 * Turns parsed rows plus the user's mapping choices into ledger records. The
 * function is pure: ids and the batch timestamp are the only moving parts.
 */
export function buildImportPlan(
  rows: ExchangeRow[],
  categoryChoices: CategoryChoice[],
  accountChoices: AccountChoice[],
  options: ImportOptions,
  context: ImportContext,
): ImportPlan {
  const categoryByKey = new Map(categoryChoices.map((choice) => [choice.key, choice]))
  const accountByKey = new Map(accountChoices.map((choice) => [choice.key, choice]))

  const createdCategories = new Map<string, Category>()
  const createdAccounts = new Map<string, Account>()
  const now = new Date().toISOString()

  const existingExternalIds = new Set<string>()
  const existingFingerprints = new Set<string>()
  for (const transaction of context.existing) {
    const externalId = transaction.importMeta?.externalId
    if (externalId) existingExternalIds.add(externalId)
    existingFingerprints.add(transactionFingerprint(transaction))
  }

  const transactions: LedgerTransaction[] = []
  let skippedTransfer = 0
  let skippedDuplicate = 0
  let skippedInvalid = 0
  let skippedByMapping = 0
  const warnings: string[] = []

  for (const row of rows) {
    if (row.direction === 'transfer') {
      skippedTransfer += 1
      continue
    }
    if (row.direction === 'unknown' || !row.date || row.amountCents <= 0) {
      skippedInvalid += 1
      continue
    }

    const type: TransactionType = row.direction === 'income' ? 'income' : 'expense'
    const categoryKey = `${type}|${row.categoryName.trim()}`
    const categoryChoice =
      categoryByKey.get(categoryKey) ??
      categoryChoices.find((choice) => choice.type === type && !choice.sourceName)
    if (!categoryChoice) {
      skippedInvalid += 1
      continue
    }

    const categoryId = resolveCategoryId(
      categoryChoice,
      createdCategories,
      context.categories,
    )
    if (!categoryId) {
      skippedByMapping += 1
      continue
    }

    const accountKey = normalizeName(row.accountName) || '__default__'
    const accountChoice =
      accountByKey.get(accountKey) ??
      accountByKey.get('__default__') ??
      accountChoices[0]
    if (!accountChoice) {
      skippedInvalid += 1
      continue
    }

    const accountId = resolveAccountId(
      accountChoice,
      createdAccounts,
      context.accounts,
    )
    if (!accountId) {
      skippedByMapping += 1
      continue
    }

    const note = row.note.trim()
    const fingerprint = transactionFingerprint({
      date: row.date,
      amountCents: row.amountCents,
      type,
      accountId,
      note,
    })

    if (options.skipDuplicates) {
      const duplicate =
        (row.externalId && existingExternalIds.has(row.externalId)) ||
        existingFingerprints.has(fingerprint)
      if (duplicate) {
        skippedDuplicate += 1
        continue
      }
    }

    const id = newTransactionId()
    const transaction: LedgerTransaction = {
      id,
      schemaVersion: 2,
      type,
      amountCents: row.amountCents,
      categoryId,
      accountId,
      date: row.date,
      note,
      allocations: [makeDailyAllocation(row.amountCents, `${id}-al-1`, 'migrated')],
      createdAt: now,
      importMeta: {
        batchId: context.batchId,
        source: context.sourceId,
        importedAt: now,
        ...(row.externalId ? { externalId: row.externalId } : {}),
        fingerprint,
        ...(Object.keys(row.extra).length > 0 ? { extra: row.extra } : {}),
      },
    }
    if (type === 'expense' && row.direction === 'refund') {
      transaction.kind = 'refund'
    }
    if (type === 'expense' && row.zhangye?.spendingNature) {
      transaction.spendingNature = row.zhangye.spendingNature
    }
    transactions.push(transaction)
  }

  if (createdCategories.size > 0) {
    warnings.push(`将新建 ${createdCategories.size} 个分类`)
  }
  if (createdAccounts.size > 0) {
    warnings.push(`将新建 ${createdAccounts.size} 个账户`)
  }

  return {
    batchId: context.batchId,
    sourceId: context.sourceId,
    transactions,
    newCategories: [...createdCategories.values()],
    newAccounts: [...createdAccounts.values()],
    skippedTransfer,
    skippedDuplicate,
    skippedInvalid,
    skippedByMapping,
    warnings,
  }
}
