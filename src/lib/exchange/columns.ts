import type {
  ColumnMapping,
  ExchangeDirection,
  ExchangeRow,
  ExchangeTable,
  FieldKey,
  ParseResult,
  SkippedRow,
} from './types'
import {
  normalizeHeader,
  parseAmountCents,
  parseDateValue,
  parseTimeValue,
  previewRow,
} from './csv'

/**
 * Column names seen in the wild. The order inside each list is also the
 * preference order, which matters where two fields could claim one header
 * (for example `时间` as either a date or a clock time).
 */
export const FIELD_ALIASES: Record<FieldKey, string[]> = {
  date: [
    '交易时间',
    '交易创建时间',
    '创建时间',
    '付款时间',
    '交易日期',
    '记账日期',
    '日期',
    '时间',
    'date',
    'datetime',
    'transactiondate',
  ],
  time: ['时间', '交易时分', '具体时间', '时分', 'time'],
  direction: [
    '收/支',
    '收/支类型',
    '收支',
    '收支类型',
    '收支方向',
    '方向',
    '类型',
    '交易类型',
    'type',
    'direction',
  ],
  expenseAmount: [
    '支出金额',
    '支出',
    '支出(元)',
    'expense',
    'expenseamount',
    'withdrawal',
    'debit',
  ],
  incomeAmount: [
    '收入金额',
    '收入',
    '收入(元)',
    'income',
    'incomeamount',
    'deposit',
    'credit',
  ],
  amount: [
    '金额(元)',
    '金额',
    '交易金额',
    '发生金额',
    '实际金额',
    'amount',
    'value',
  ],
  category: [
    '分类',
    '类别',
    '交易分类',
    '分类名称',
    '类目',
    '账单分类',
    'category',
  ],
  account: [
    '账户',
    '账户名称',
    '支付方式',
    '支付账户',
    '账户/卡',
    '卡片',
    'account',
    'accountname',
  ],
  note: [
    '备注',
    '说明',
    '摘要',
    '描述',
    '交易对方',
    '交易商户',
    '对方',
    '商品',
    '商品名称',
    'note',
    'memo',
    'payee',
    'merchant',
    'description',
  ],
  externalId: [
    '交易单号',
    '交易号',
    '订单号',
    '商家订单号',
    '流水号',
    '外部单号',
    '交易编号',
    'transactionid',
    'orderid',
  ],
  status: ['交易状态', '当前状态', '状态', 'status'],
  tags: ['标签', '标签名称', 'tags', 'label'],
  zhangye: ['账页扩展', '扩展', 'x_zhangye', 'zhangye'],
}

const KNOWN_HEADERS = new Set(
  Object.values(FIELD_ALIASES)
    .flat()
    .map((alias) => normalizeHeader(alias)),
)

const DIRECTION_WORDS =
  /^(支出|付款|消费|转出|支出金额|expense|out|借|withdrawal|debit|收入|收款|转入|入账|income|in|贷|deposit|credit|不计收支|转账|transfer|退款|refund)$/i

function looksLikeDirection(value: string): boolean {
  return DIRECTION_WORDS.test(value.trim())
}

function ratioMatching(values: string[], test: (value: string) => boolean): number {
  const filled = values.filter((value) => value.trim().length > 0)
  if (filled.length === 0) return 0
  return filled.filter(test).length / filled.length
}

/**
 * Finds the header row. Bill exports carry several lines of preamble, so the
 * row with the most recognisable field names wins; a file with unknown headers
 * still gets a table using its first non-empty row.
 */
export function buildTable(rows: string[][]): ExchangeTable | null {
  const limit = Math.min(rows.length, 120)
  let bestIndex = -1
  let bestScore = 0

  for (let index = 0; index < limit; index += 1) {
    const row = rows[index]
    if (!row || row.length < 2) continue
    const score = row.filter((cell) =>
      KNOWN_HEADERS.has(normalizeHeader(cell)),
    ).length
    if (score > bestScore) {
      bestScore = score
      bestIndex = index
    }
  }

  if (bestIndex < 0 || bestScore < 2) {
    for (let index = 0; index < limit; index += 1) {
      const row = rows[index]
      if (row && row.filter((cell) => cell.length > 0).length >= 2) {
        bestIndex = index
        bestScore = 1
        break
      }
    }
  }

  if (bestIndex < 0) return null

  const headers = rows[bestIndex].map((cell) => cell.replace(/^﻿/, '').trim())
  const body = rows
    .slice(bestIndex + 1)
    .filter((row) => row.some((cell) => cell.length > 0))

  return { headers, rows: body, headerIndex: bestIndex }
}

export interface HeaderDetection {
  mapping: ColumnMapping
  /** Header names that were not claimed by any field. */
  unused: string[]
  headerUseful: boolean
}

/**
 * Assigns headers to fields. Each field walks its aliases in preference order,
 * so `收/支` beats `交易类型` for direction, and `支出金额` is never read as a
 * generic amount.
 */
export function detectHeaders(table: ExchangeTable): HeaderDetection {
  const samples = table.rows.slice(0, 80)
  const used = new Set<number>()
  const mapping: ColumnMapping = {}

  const columnFor = (field: FieldKey): number | null => {
    for (const alias of FIELD_ALIASES[field]) {
      const wanted = normalizeHeader(alias)
      for (let index = 0; index < table.headers.length; index += 1) {
        if (used.has(index)) continue
        if (normalizeHeader(table.headers[index]) !== wanted) continue

        const values = samples.map((row) => row[index] ?? '')

        if (field === 'date') {
          const hasDate = values.some((value) => parseDateValue(value) !== null)
          if (!hasDate) continue
        }
        if (field === 'direction') {
          const headerName = normalizeHeader(table.headers[index])
          const ambiguous =
            headerName === '类型' || headerName === '交易类型'
          if (ambiguous && ratioMatching(values, looksLikeDirection) < 0.6) {
            continue
          }
          if (ratioMatching(values, (value) => value.trim().length > 0) === 0) {
            continue
          }
        }

        used.add(index)
        return index
      }
    }
    return null
  }

  const ordered: FieldKey[] = [
    'date',
    'time',
    'direction',
    'expenseAmount',
    'incomeAmount',
    'amount',
    'category',
    'account',
    'note',
    'externalId',
    'status',
    'tags',
    'zhangye',
  ]

  for (const field of ordered) {
    const index = columnFor(field)
    if (index !== null) mapping[field] = table.headers[index]
  }

  const unused = table.headers.filter((_, index) => !used.has(index))
  return {
    mapping,
    unused,
    headerUseful: Object.keys(mapping).length >= 2,
  }
}

export function directionFromText(text: string): ExchangeDirection {
  const value = text.trim().toLowerCase()
  if (!value) return 'unknown'
  if (/退款|退货|冲正|refund|已退/.test(value)) return 'refund'
  if (/不计收支|转账|转出|转入|transfer|提现|还款/.test(value)) return 'transfer'
  if (/^收入|收入$|收款|入账|存入|income|deposit|credit|^in$|^贷$/.test(value)) {
    return 'income'
  }
  if (/^支出|支出$|付款|消费|扣款|expense|withdrawal|debit|^out$|^借$/.test(value)) {
    return 'expense'
  }
  return 'unknown'
}

/** Statuses that mean the money never moved. */
export function isClosedStatus(text: string): boolean {
  return /关闭|已撤销|交易失败|支付失败|等待付款|未支付|已取消|取消交易/.test(text)
}

export interface ParseOptions {
  /** Account name used when the file has no account column. */
  defaultAccountName: string
  /** What to assume when no direction column exists. Defaults to expense. */
  defaultDirection?: Exclude<ExchangeDirection, 'unknown' | 'transfer'>
  /** Extra columns joined into the note after the mapped note column. */
  noteColumns?: string[]
  /** Maps the source status text to a skip reason. */
  statusSkip?: (status: string) => string | null
}

function headerIndex(table: ExchangeTable, name: string | undefined): number {
  if (!name) return -1
  const wanted = normalizeHeader(name)
  return table.headers.findIndex((header) => normalizeHeader(header) === wanted)
}

function cellAt(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? '').trim() : ''
}

function joinNote(parts: string[]): string {
  const seen = new Set<string>()
  const kept: string[] = []
  for (const part of parts) {
    const text = part.trim()
    if (!text || text === '/' || text === '-' || text === '—') continue
    if (seen.has(text)) continue
    seen.add(text)
    kept.push(text)
  }
  return kept.join(' · ')
}

function parseZhangye(raw: string): ExchangeRow['zhangye'] {
  if (!raw.trim()) return undefined
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const result: NonNullable<ExchangeRow['zhangye']> = {}
    if (parsed.nature === 'essential' || parsed.nature === 'flexible') {
      result.spendingNature = parsed.nature
    }
    if (parsed.kind === 'refund') result.kind = 'refund'
    return Object.keys(result).length > 0 ? result : undefined
  } catch {
    return undefined
  }
}

function rowLooksEmpty(row: string[]): boolean {
  return !row.some((cell) => cell.trim().length > 0)
}

/**
 * The shared row reader used by the generic adapter and by every app adapter
 * whose export is a plain table.
 */
export function parseWithMapping(
  table: ExchangeTable,
  mapping: ColumnMapping,
  options: ParseOptions,
): ParseResult {
  const rows: ExchangeRow[] = []
  const skipped: SkippedRow[] = []
  const warnings: string[] = []

  const indexOf: Partial<Record<FieldKey, number>> = {}
  for (const key of Object.keys(mapping) as FieldKey[]) {
    indexOf[key] = headerIndex(table, mapping[key])
  }

  const mappedHeaders = new Set(
    Object.values(mapping).map((name) => normalizeHeader(name ?? '')),
  )

  const noteExtraColumns = (options.noteColumns ?? [])
    .map((name) => headerIndex(table, name))
    .filter((index) => index >= 0)
  const noteExtraSet = new Set(noteExtraColumns)

  // Columns joined into the note are already represented, so they are not
  // repeated in the extension block.
  const extraColumns = table.headers
    .map((header, index) => ({ header, index }))
    .filter(
      ({ header, index }) =>
        !mappedHeaders.has(normalizeHeader(header)) &&
        !noteExtraSet.has(index),
    )

  let unknownDirection = 0

  table.rows.forEach((rawRow, index) => {
    if (rowLooksEmpty(rawRow)) return
    const rowNumber = index + 1
    const row = rawRow

    const status = cellAt(row, indexOf.status ?? -1)
    const skipReason = options.statusSkip?.(status) ?? null
    if (skipReason) {
      skipped.push({ rowNumber, reason: skipReason, preview: previewRow(row) })
      return
    }

    let date = ''
    let time = cellAt(row, indexOf.time ?? -1)
    const dateCell = cellAt(row, indexOf.date ?? -1)
    const parsedDate = parseDateValue(dateCell)
    if (parsedDate) {
      date = parsedDate.date
      if (!time) time = parsedDate.time
    }
    if (!time) time = parseTimeValue(dateCell)

    const amountCell = cellAt(row, indexOf.amount ?? -1)
    const expenseCell = cellAt(row, indexOf.expenseAmount ?? -1)
    const incomeCell = cellAt(row, indexOf.incomeAmount ?? -1)
    let amountCents = parseAmountCents(amountCell)
    if (amountCents === null) amountCents = parseAmountCents(expenseCell)
    if (amountCents === null) amountCents = parseAmountCents(incomeCell)

    if (!date) {
      skipped.push({ rowNumber, reason: '日期无法识别', preview: previewRow(row) })
      return
    }
    if (amountCents === null || amountCents === 0) {
      skipped.push({ rowNumber, reason: '金额无法识别', preview: previewRow(row) })
      return
    }

    let direction = directionFromText(cellAt(row, indexOf.direction ?? -1))
    if (direction === 'unknown') {
      if (amountCents < 0) direction = 'expense'
      else if (!expenseCell && incomeCell) direction = 'income'
      else if (expenseCell && !incomeCell) direction = 'expense'
      else direction = options.defaultDirection ?? 'expense'
      if (!cellAt(row, indexOf.direction ?? -1)) unknownDirection += 1
    }
    amountCents = Math.abs(amountCents)

    const categoryName = cellAt(row, indexOf.category ?? -1)
    const accountName =
      cellAt(row, indexOf.account ?? -1) || options.defaultAccountName
    const noteParts = [cellAt(row, indexOf.note ?? -1)]
    for (const noteIndex of noteExtraColumns) {
      noteParts.push(cellAt(row, noteIndex))
    }
    const externalId = cellAt(row, indexOf.externalId ?? -1)
    const tagsCell = cellAt(row, indexOf.tags ?? -1)
    const tags = tagsCell
      ? tagsCell.split(/[,，;；|]/).map((tag) => tag.trim()).filter(Boolean)
      : []

    const extra: Record<string, string> = {}
    for (const { header, index: columnIndex } of extraColumns) {
      const value = cellAt(row, columnIndex)
      if (!value) continue
      extra[header.slice(0, 80)] = value.slice(0, 300)
    }

    const raw: Record<string, string> = {}
    table.headers.forEach((header, columnIndex) => {
      raw[header] = row[columnIndex] ?? ''
    })

    rows.push({
      rowNumber,
      date,
      time,
      direction,
      amountCents,
      categoryName,
      accountName,
      note: joinNote(noteParts),
      externalId,
      tags,
      extra,
      zhangye: parseZhangye(cellAt(row, indexOf.zhangye ?? -1)),
      raw,
    })
  })

  if (unknownDirection > 0 && !mapping.direction) {
    warnings.push(
      `没有收支方向列，${unknownDirection} 笔按${options.defaultDirection === 'income' ? '收入' : '支出'}处理，可在字段映射中指定`,
    )
  }

  return { rows, skipped, mapping, warnings }
}
