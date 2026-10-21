export type TransactionType = 'expense' | 'income'

export type View = 'overview' | 'transactions' | 'analytics'

export type Theme = 'light' | 'dark'

export type Palette = 'forest' | 'gold' | 'navy' | 'rose'

export interface LedgerTransaction {
  id: string
  type: TransactionType
  amount: number
  categoryId: string
  accountId: string
  date: string
  note: string
  createdAt: string
}

export interface Category {
  id: string
  name: string
  type: TransactionType
}

export interface Account {
  id: string
  name: string
}

export interface MonthTotals {
  income: number
  expense: number
  balance: number
}

export interface MonthDatum {
  key: string
  label: string
  value: number
}

export interface MonthPairDatum {
  key: string
  label: string
  income: number
  expense: number
}

export interface DailyDatum {
  day: number
  value: number
}

export interface CategoryTotal {
  category: Category
  value: number
  share: number
}

export type TransactionDraft = Omit<LedgerTransaction, 'id' | 'createdAt'>
