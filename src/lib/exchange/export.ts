import type {
  Account,
  Category,
  LedgerTransaction,
  Project,
  SavingsTransfer,
} from '../../types'
import { formatCents, toCsv } from './csv'

export const EXCHANGE_CSV_HEADER = [
  '日期',
  '时间',
  '类型',
  '分类',
  '账户',
  '金额',
  '备注',
  '标签',
  '项目',
  '外部单号',
  '账页扩展',
] as const

function categoryPath(categories: Category[], id: string): string {
  const category = categories.find((item) => item.id === id)
  if (!category) return '未分类'
  if (!category.parentId) return category.name
  const parent = categories.find((item) => item.id === category.parentId)
  return parent ? `${parent.name} · ${category.name}` : category.name
}

function accountName(accounts: Account[], id: string): string {
  return accounts.find((account) => account.id === id)?.name ?? id
}

function projectName(projects: Project[], id: string): string {
  return projects.find((project) => project.id === id)?.name ?? id
}

function typeLabel(transaction: LedgerTransaction): string {
  if (transaction.kind === 'refund') return '退款'
  return transaction.type === 'income' ? '收入' : '支出'
}

/**
 * One row per transaction with a `账页扩展` column holding what other apps do
 * not have (essential/flexible, refund flag, recurring link, project split).
 * Other software ignores the column; importing the file back restores what it
 * understands. The first six columns keep the shape of the older export so
 * existing spreadsheets still line up.
 */
export function transactionsToExchangeCsv(
  transactions: LedgerTransaction[],
  categories: Category[],
  accounts: Account[],
  projects: Project[],
  transfers: SavingsTransfer[] = [],
): string {
  const rows: Array<Array<string | number>> = [[...EXCHANGE_CSV_HEADER]]

  for (const transfer of transfers) {
    const label =
      transfer.direction === 'toSavings'
        ? `转入储蓄 · ${transfer.holdingName}`
        : `从储蓄转回 · ${transfer.holdingName}`
    rows.push([
      transfer.date,
      '',
      '转账',
      label,
      transfer.accountId
        ? accountName(accounts, transfer.accountId)
        : '储蓄',
      formatCents(transfer.amountCents),
      transfer.note ?? '',
      '',
      '',
      '',
      JSON.stringify({
        savings: {
          holdingId: transfer.holdingId,
          direction: transfer.direction,
        },
      }),
    ])
  }

  for (const transaction of transactions) {
    const projectAllocations = transaction.allocations.filter(
      (allocation) => allocation.targetType === 'project' && allocation.projectId,
    )
    const projectNames = projectAllocations
      .map((allocation) => projectName(projects, allocation.projectId as string))
      .join(' / ')

    const extension: Record<string, unknown> = {}
    if (transaction.spendingNature) extension.nature = transaction.spendingNature
    if (transaction.kind) extension.kind = transaction.kind
    if (transaction.recurringRuleId) {
      extension.recurring = transaction.recurringRuleId
    }
    if (projectAllocations.length > 0) {
      extension.projects = projectAllocations.map((allocation) => ({
        projectId: allocation.projectId,
        amountCents: allocation.amountCents,
      }))
    }

    rows.push([
      transaction.date,
      '',
      typeLabel(transaction),
      categoryPath(categories, transaction.categoryId),
      accountName(accounts, transaction.accountId),
      formatCents(transaction.amountCents),
      transaction.note,
      '',
      projectNames,
      transaction.importMeta?.externalId ?? '',
      Object.keys(extension).length > 0 ? JSON.stringify(extension) : '',
    ])
  }

  if (transfers.length === 0) return toCsv(rows)
  const [header, ...body] = rows
  body.sort((left, right) =>
    String(right[0]).localeCompare(String(left[0])),
  )
  return toCsv([header, ...body])
}
