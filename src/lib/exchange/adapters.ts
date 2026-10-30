import type {
  ColumnMapping,
  ExchangeAdapter,
  ExchangeRow,
  ExchangeTable,
  ParseResult,
} from './types'
import { normalizeHeader, parseAmountCents, previewRow } from './csv'
import {
  detectHeaders,
  isClosedStatus,
  parseWithMapping,
} from './columns'

function findHeader(table: ExchangeTable, names: string[]): string | undefined {
  const wanted = names.map((name) => normalizeHeader(name))
  for (const candidate of wanted) {
    const index = table.headers.findIndex(
      (header) => normalizeHeader(header) === candidate,
    )
    if (index >= 0) return table.headers[index]
  }
  return undefined
}

/** Only the text before the header row: app markers live in the preamble,
 *  not in merchant names or notes further down the file. */
function preamble(table: ExchangeTable, text: string): string {
  if (table.headerIndex <= 0) return ''
  return text.split(/\r?\n/).slice(0, table.headerIndex).join('\n')
}

function headersInclude(table: ExchangeTable, names: string[]): number {
  let hits = 0
  for (const name of names) {
    if (findHeader(table, [name])) hits += 1
  }
  return hits
}

function cell(row: ExchangeRow, header: string): string {
  return (row.raw[header] ?? '').trim()
}

function defaultStatusSkip(status: string): string | null {
  return isClosedStatus(status) ? '交易未完成或已关闭' : null
}

/** Reads a table through the alias engine. The default account fills gaps. */
function parseAppTable(
  table: ExchangeTable,
  mappingOverride: ColumnMapping | undefined,
  defaultAccountName: string,
): ParseResult {
  const detection = detectHeaders(table)
  const mapping: ColumnMapping = { ...detection.mapping, ...mappingOverride }
  return parseWithMapping(table, mapping, {
    defaultAccountName,
    defaultDirection: 'expense',
    statusSkip: defaultStatusSkip,
  })
}

/** 微信支付账单 CSV. */
const wechat: ExchangeAdapter = {
  id: 'wechat',
  label: '微信支付账单',
  description: '微信 → 我 → 服务 → 钱包 → 账单 → 导出账单',
  accountType: 'wechat',
  detect(table, text) {
    if (/微信支付账单|微信昵称|微信支付明细/.test(preamble(table, text))) {
      return 0.98
    }
    const hits = headersInclude(table, ['交易单号', '支付方式', '收/支'])
    return hits >= 3 ? 0.9 : 0
  },
  parse(table, _text, mappingOverride) {
    const mapping: ColumnMapping = {
      date: findHeader(table, ['交易时间', '时间']),
      direction: findHeader(table, ['收/支', '收支']),
      amount: findHeader(table, ['金额(元)', '金额']),
      account: findHeader(table, ['支付方式', '账户']),
      externalId: findHeader(table, ['交易单号', '交易号']),
      status: findHeader(table, ['当前状态', '交易状态', '状态']),
      note: findHeader(table, ['备注']),
      ...mappingOverride,
    }
    const result = parseWithMapping(table, mapping, {
      defaultAccountName: '微信',
      noteColumns: [
        findHeader(table, ['交易对方', '交易商户']) ?? '',
        findHeader(table, ['商品', '商品名称']) ?? '',
      ].filter(Boolean),
      statusSkip: defaultStatusSkip,
    })

    const typeHeader = findHeader(table, ['交易类型'])
    const statusHeader = findHeader(table, ['当前状态', '交易状态'])
    for (const row of result.rows) {
      const type = typeHeader ? cell(row, typeHeader) : ''
      const status = statusHeader ? cell(row, statusHeader) : ''
      if (
        row.direction !== 'expense' &&
        /退款|退货|冲正/.test(`${type} ${status}`)
      ) {
        row.direction = 'refund'
      }
      // 「商户消费」是账单分类的占位词，不值得为它建一个分类。
      if (row.direction === 'expense' && !/红包|转账|群收款/.test(type)) {
        row.categoryName = ''
      } else if (row.direction === 'income' || row.direction === 'refund') {
        row.categoryName = /红包/.test(type) ? '红包' : ''
      } else {
        row.categoryName = ''
      }
      if (!row.note) row.note = type
    }
    return result
  },
}

/** 支付宝交易明细 CSV (older exports are GBK; decoding happens earlier). */
const alipay: ExchangeAdapter = {
  id: 'alipay',
  label: '支付宝账单',
  description: '支付宝 → 我的 → 账单 → 右上角 … → 开具交易流水证明',
  accountType: 'alipay',
  detect(table, text) {
    if (
      /支付宝交易记录|支付宝.{0,6}网络技术|alipay/i.test(preamble(table, text))
    ) {
      return 0.98
    }
    const hits = headersInclude(table, ['交易号', '收/支', '金额(元)'])
    return hits >= 3 ? 0.9 : 0
  },
  parse(table, _text, mappingOverride) {
    const mapping: ColumnMapping = {
      date: findHeader(table, ['交易创建时间', '付款时间', '交易时间']),
      direction: findHeader(table, ['收/支', '收支']),
      amount: findHeader(table, ['金额(元)', '金额']),
      category: findHeader(table, ['交易分类', '账单分类', '分类名称', '分类']),
      externalId: findHeader(table, ['交易号', '交易单号']),
      status: findHeader(table, ['交易状态', '状态']),
      note: findHeader(table, ['备注']),
      ...mappingOverride,
    }
    const result = parseWithMapping(table, mapping, {
      defaultAccountName: '支付宝',
      noteColumns: [
        findHeader(table, ['交易对方']) ?? '',
        findHeader(table, ['商品名称', '商品']) ?? '',
      ].filter(Boolean),
      statusSkip: (status) =>
        /等待付款|交易关闭|已关闭|交易失败|已撤销/.test(status)
          ? '交易未完成或已关闭'
          : null,
    })

    const typeHeader = findHeader(table, ['类型', '交易类型'])
    const categoryHeader = findHeader(table, [
      '交易分类',
      '账单分类',
      '分类名称',
      '分类',
    ])
    const refundHeader = findHeader(table, ['成功退款(元)', '成功退款'])
    const extra: ExchangeRow[] = []
    for (const row of result.rows) {
      const type = typeHeader ? cell(row, typeHeader) : ''
      const refundCents =
        (refundHeader && parseAmountCents(cell(row, refundHeader))) || 0

      if (row.direction !== 'expense' && /退款/.test(type)) {
        row.direction = 'refund'
      }
      // Newer Alipay statements carry a real category column; older ones do
      // not, in which case the row falls back to the ledger's 其他.
      row.categoryName = categoryHeader ? cell(row, categoryHeader) : ''

      // Alipay puts a partial refund on the original row instead of adding a
      // row of its own, so the offset has to be created here.
      if (refundCents > 0 && row.direction === 'expense') {
        extra.push({
          ...row,
          rowNumber: row.rowNumber,
          direction: 'refund',
          amountCents: refundCents,
          note: row.note ? `退款 · ${row.note}` : '退款',
          externalId: row.externalId ? `${row.externalId}-refund` : '',
        })
      }
    }
    result.rows.push(...extra)
    return result
  },
}

interface AppAdapterConfig {
  id: string
  label: string
  description: string
  markers: RegExp
  defaultAccountName: string
  signature?: string[]
}

/**
 * Apps whose export is already a clean table. They share the alias engine;
 * detection only fires on their own preamble so a generic CSV is not
 * mislabelled as one of them.
 */
function appAdapter(config: AppAdapterConfig): ExchangeAdapter {
  return {
    id: config.id,
    label: config.label,
    description: config.description,
    accountType: 'cash',
    detect(table, text) {
      if (config.markers.test(preamble(table, text))) return 0.95
      if (config.signature && headersInclude(table, config.signature) >= 3) {
        return 0.45
      }
      return 0
    },
    parse(table, _text, mappingOverride) {
      return parseAppTable(table, mappingOverride, config.defaultAccountName)
    },
  }
}

const suishouji = appAdapter({
  id: 'suishouji',
  label: '随手记',
  description: '随手记 → 设置 → 数据导出 → CSV',
  markers: /随手记|随手科技|suishouji/i,
  defaultAccountName: '现金',
  signature: ['日期', '分类', '金额', '账户'],
})

const qianji = appAdapter({
  id: 'qianji',
  label: '钱迹',
  description: '钱迹 → 设置 → 导出数据 → CSV',
  markers: /钱迹|qianji/i,
  defaultAccountName: '现金',
  signature: ['时间', '分类', '金额', '账户'],
})

const shark = appAdapter({
  id: 'shark',
  label: '鲨鱼记账',
  description: '鲨鱼记账 → 我的 → 数据导出 → CSV',
  markers: /鲨鱼记账|shark/i,
  defaultAccountName: '现金',
  signature: ['日期', '分类', '金额'],
})

const yimu = appAdapter({
  id: 'yimu',
  label: '一木记账',
  description: '一木记账 → 设置 → 导出账单 → CSV',
  markers: /一木记账|一木/,
  defaultAccountName: '现金',
  signature: ['日期', '分类', '金额', '备注'],
})

const miaomiao = appAdapter({
  id: 'miaomiao',
  label: '喵喵记账',
  description: '喵喵记账 → 我的 → 数据导出 → CSV',
  markers: /喵喵记账|miaomiao/i,
  defaultAccountName: '现金',
})

const icost = appAdapter({
  id: 'icost',
  label: 'iCost / 轻记账',
  description: 'iCost → 设置 → 数据导出 → CSV',
  markers: /icost|轻记账/i,
  defaultAccountName: '现金',
  signature: ['日期', '分类', '金额'],
})

const moneywiz = appAdapter({
  id: 'moneywiz',
  label: 'MoneyWiz / 通用英文账单',
  description: 'MoneyWiz → 导出 → CSV',
  markers: /moneywiz/i,
  defaultAccountName: '银行卡',
  signature: ['Date', 'Amount', 'Category', 'Account'],
})

/** Any table the adapters above did not claim. The wizard lets the user map
 *  columns by hand, so this is the safety net for long-tail apps. */
const generic: ExchangeAdapter = {
  id: 'csv',
  label: '通用 CSV / 其他软件',
  description: '只要能导出 CSV，就能在下一步手动对应各列',
  detect(table) {
    const detection = detectHeaders(table)
    if (!detection.headerUseful) return 0.1
    return detection.mapping.date && detection.mapping.amount ? 0.55 : 0.3
  },
  parse(table, _text, mappingOverride) {
    const detection = detectHeaders(table)
    const mapping: ColumnMapping = { ...detection.mapping, ...mappingOverride }
    return parseWithMapping(table, mapping, {
      defaultAccountName: '现金',
      defaultDirection: 'expense',
      statusSkip: defaultStatusSkip,
    })
  },
}

export const ADAPTERS: ExchangeAdapter[] = [
  wechat,
  alipay,
  suishouji,
  qianji,
  shark,
  yimu,
  miaomiao,
  icost,
  moneywiz,
  generic,
]

export function getAdapter(id: string): ExchangeAdapter {
  return ADAPTERS.find((adapter) => adapter.id === id) ?? generic
}

export interface AdapterMatch {
  adapter: ExchangeAdapter
  confidence: number
}

/** Every adapter that recognises something, best first. */
export function detectAdapters(
  table: ExchangeTable,
  text: string,
): AdapterMatch[] {
  return ADAPTERS.map((adapter) => ({
    adapter,
    confidence: adapter.detect(table, text),
  }))
    .filter((match) => match.confidence > 0)
    .sort((left, right) => right.confidence - left.confidence)
}

/** Picks the best adapter, preferring the strongest match then list order. */
export function detectAdapter(table: ExchangeTable, text: string): ExchangeAdapter {
  return detectAdapters(table, text)[0]?.adapter ?? generic
}

/** The column headers worth showing in the manual mapping step. */
export function mappingFields(): Array<{
  key: keyof ColumnMapping
  label: string
  required?: boolean
}> {
  return [
    { key: 'date', label: '日期', required: true },
    { key: 'time', label: '时间（单独一列时）' },
    { key: 'amount', label: '金额', required: true },
    { key: 'direction', label: '收支方向' },
    { key: 'expenseAmount', label: '支出金额（分开列时）' },
    { key: 'incomeAmount', label: '收入金额（分开列时）' },
    { key: 'category', label: '分类' },
    { key: 'account', label: '账户' },
    { key: 'note', label: '备注 / 对方' },
    { key: 'externalId', label: '交易单号' },
    { key: 'status', label: '交易状态' },
    { key: 'tags', label: '标签' },
    { key: 'zhangye', label: '账页扩展（账页专用）' },
  ]
}

/** A short human preview of a parsed row, used by the wizard table. */
export function rowPreview(row: ExchangeRow, limit = 48): string {
  return previewRow([row.date, row.categoryName, row.note], limit)
}
