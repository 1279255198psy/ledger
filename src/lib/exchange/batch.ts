import type { Category, LedgerTransaction } from '../../types'

const STORAGE_KEY = 'zhangye.import.last.v1'

export interface LastImport {
  batchId: string
  /** ISO timestamp. */
  at: string
  sourceLabel: string
  count: number
  /** Categories/accounts this batch created, so undo can remove unused ones. */
  createdCategoryIds: string[]
  createdAccountIds: string[]
}

export function loadLastImport(): LastImport | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastImport>
    if (
      typeof parsed.batchId !== 'string' ||
      typeof parsed.at !== 'string' ||
      typeof parsed.count !== 'number'
    ) {
      return null
    }
    return {
      batchId: parsed.batchId,
      at: parsed.at,
      sourceLabel:
        typeof parsed.sourceLabel === 'string' ? parsed.sourceLabel : '导入',
      count: parsed.count,
      createdCategoryIds: Array.isArray(parsed.createdCategoryIds)
        ? parsed.createdCategoryIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : [],
      createdAccountIds: Array.isArray(parsed.createdAccountIds)
        ? parsed.createdAccountIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : [],
    }
  } catch {
    return null
  }
}

export function saveLastImport(info: LastImport): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(info))
  } catch {
    // A missing undo record only costs convenience.
  }
}

export function clearLastImport(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Ignore: the record is best-effort.
  }
}

/** Drops every transaction that belongs to one import batch. */
export function removeImportBatch(
  transactions: LedgerTransaction[],
  batchId: string,
): LedgerTransaction[] {
  return transactions.filter(
    (transaction) => transaction.importMeta?.batchId !== batchId,
  )
}

/** Categories created by a batch that no remaining transaction uses. */
export function unusedCreatedCategories(
  categories: Category[],
  transactions: LedgerTransaction[],
  createdIds: string[],
): string[] {
  const known = new Set(categories.map((category) => category.id))
  const used = new Set(transactions.map((transaction) => transaction.categoryId))
  return createdIds.filter((id) => known.has(id) && !used.has(id))
}

export function unusedCreatedAccounts(
  accounts: { id: string }[],
  transactions: LedgerTransaction[],
  createdIds: string[],
): string[] {
  const known = new Set(accounts.map((account) => account.id))
  const used = new Set(transactions.map((transaction) => transaction.accountId))
  return createdIds.filter((id) => known.has(id) && !used.has(id))
}
