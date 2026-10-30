import type {
  Account,
  AccountType,
  Category,
  LedgerTransaction,
  SpendingNature,
  TransactionKind,
} from '../../types'

/**
 * A row as the source file describes it: still carrying the source's own
 * category and account names, before anything is matched to the ledger.
 */
export type ExchangeDirection =
  | 'expense'
  | 'income'
  | 'refund'
  | 'transfer'
  | 'unknown'

export interface ExchangeRow {
  /** 1-based position among the data rows, used to point back at the file. */
  rowNumber: number
  /** YYYY-MM-DD. Empty when the source date could not be understood. */
  date: string
  /** HH:mm when the source carries a time. */
  time: string
  direction: ExchangeDirection
  /** Always positive; direction carries the sign. */
  amountCents: number
  categoryName: string
  accountName: string
  note: string
  externalId: string
  tags: string[]
  /** Columns that had no field of their own, kept verbatim. */
  extra: Record<string, string>
  /** Restored from the `账页扩展` column when re-importing our own export. */
  zhangye?: {
    spendingNature?: SpendingNature
    kind?: TransactionKind
  }
  raw: Record<string, string>
}

export interface SkippedRow {
  rowNumber: number
  reason: string
  preview: string
}

export type FieldKey =
  | 'date'
  | 'time'
  | 'direction'
  | 'amount'
  | 'expenseAmount'
  | 'incomeAmount'
  | 'category'
  | 'account'
  | 'note'
  | 'externalId'
  | 'status'
  | 'tags'
  | 'zhangye'

export type ColumnMapping = Partial<Record<FieldKey, string>>

export interface ExchangeTable {
  headers: string[]
  rows: string[][]
  /** Zero-based line index of the header row inside the original text. */
  headerIndex: number
}

export interface ParseResult {
  rows: ExchangeRow[]
  skipped: SkippedRow[]
  mapping: ColumnMapping
  warnings: string[]
}

export interface ExchangeAdapter {
  id: string
  label: string
  description: string
  /** Used when the file has no account column at all. */
  accountType?: AccountType
  detect(table: ExchangeTable, text: string): number
  parse(
    table: ExchangeTable,
    text: string,
    mapping?: ColumnMapping,
  ): ParseResult
}

export type CategoryTarget =
  | { kind: 'existing'; id: string }
  | { kind: 'create'; name: string; parentId?: string }
  | { kind: 'skip' }

export type AccountTarget =
  | { kind: 'existing'; id: string }
  | { kind: 'create'; name: string; type: AccountType }
  | { kind: 'skip' }

export interface CategoryChoice {
  /** `${type}|${name}`; the empty name shares one default per type. */
  key: string
  type: 'expense' | 'income'
  sourceName: string
  count: number
  target: CategoryTarget
}

export interface AccountChoice {
  key: string
  sourceName: string
  count: number
  target: AccountTarget
}

export interface ImportOptions {
  skipDuplicates: boolean
  skipTransfers: boolean
}

/**
 * A reusable mapping preset: which column is which, and how source category
 * and account names translate. Saved by the user, stored on this device.
 */
export interface ImportTemplate {
  id: string
  name: string
  /** Adapter id the template was built for. */
  sourceId: string
  createdAt: string
  updatedAt: string
  /** Effective column mapping; an empty string means "do not use this column". */
  mapping: ColumnMapping
  /** Category choice key (`${type}|${sourceName}`) → target. */
  categories: Record<string, CategoryTarget>
  /** Account choice key (normalized name, or `__default__`) → target. */
  accounts: Record<string, AccountTarget>
}

export interface ImportContext {
  categories: Category[]
  accounts: Account[]
  existing: LedgerTransaction[]
  sourceId: string
  batchId: string
}

export interface ImportPlan {
  batchId: string
  /** Adapter id, so callers can report which format produced the batch. */
  sourceId: string
  transactions: LedgerTransaction[]
  newCategories: Category[]
  newAccounts: Account[]
  skippedTransfer: number
  skippedDuplicate: number
  skippedInvalid: number
  /** Rows the user chose to leave out through the category/account mapping. */
  skippedByMapping: number
  warnings: string[]
}
