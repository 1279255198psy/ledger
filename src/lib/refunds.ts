import type { AllocationLine, LedgerTransaction } from '../types'

/**
 * A refund is stored exactly like the purchase it reverses — positive amount,
 * filed under the same category — and only turns negative when something adds
 * it up. Storing the true paid amount keeps the record readable; negating at
 * aggregation time keeps every total consistent without a second sign field.
 */
export function isRefund(transaction: {
  kind?: LedgerTransaction['kind']
}): boolean {
  return transaction.kind === 'refund'
}

/** What an expense total should add for this record. */
export function expenseDeltaCents(transaction: LedgerTransaction): number {
  return isRefund(transaction)
    ? -transaction.amountCents
    : transaction.amountCents
}

/** The same sign, applied to one allocation so projects and daily buckets agree. */
export function allocationDeltaCents(
  transaction: LedgerTransaction,
  line: AllocationLine,
): number {
  return isRefund(transaction) ? -line.amountCents : line.amountCents
}

/** Effect on an account balance: a refund puts money back. */
export function balanceDeltaCents(transaction: LedgerTransaction): number {
  if (transaction.type === 'income') return transaction.amountCents
  return isRefund(transaction) ? transaction.amountCents : -transaction.amountCents
}

/** Human wording for toasts and row metadata. */
export function transactionKindLabel(transaction: LedgerTransaction): string {
  if (isRefund(transaction)) return '退款'
  return transaction.type === 'expense' ? '支出' : '收入'
}
