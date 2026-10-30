/**
 * Standalone checks for the exchange adapters and the import plan. Run with:
 *   npm run test:exchange
 */
import assert from 'node:assert/strict'
import { DEFAULT_ACCOUNTS } from '../src/lib/accounts'
import { DEFAULT_CATEGORIES } from '../src/lib/categories'
import { ADAPTERS, detectAdapters, getAdapter } from '../src/lib/exchange/adapters'
import { buildTable, detectHeaders } from '../src/lib/exchange/columns'
import {
  cleanRows,
  decodeBytes,
  parseAmountCents,
  parseCsv,
  parseDateValue,
} from '../src/lib/exchange/csv'
import { transactionsToExchangeCsv } from '../src/lib/exchange/export'
import {
  buildImportPlan,
  matchCategory,
  suggestAccountChoices,
  suggestCategoryChoices,
  transactionFingerprint,
} from '../src/lib/exchange/plan'
import { removeImportBatch } from '../src/lib/exchange/batch'
import {
  applyAccountTargets,
  applyCategoryTargets,
  buildTemplate,
  mappingForHeaders,
  upsertTemplate,
} from '../src/lib/exchange/templates'

const WECHAT = `微信支付账单明细
微信昵称：[测试]
起始时间：[2026-09-01 00:00:00] 终止时间：[2026-09-30 23:59:59]

----------------------微信支付账单明细列表--------------------
交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注
2026-09-01 12:30:00,商户消费,星巴克,拿铁,支出,¥32.00,零钱,支付成功,4200001,m1,/
2026-09-02 09:00:00,微信红包,张三,,收入,¥88.00,零钱,已存入零钱,4200002,m2,/
2026-09-03 10:00:00,转账,李四,,不计收支,¥100.00,零钱,已转账,4200003,m3,/
2026-09-04 11:00:00,商户消费,某店,商品,支出,¥20.00,招商银行储蓄卡(1234),已全额退款,4200004,m4,/
2026-09-05 12:00:00,退款,某店,商品,收入,¥20.00,零钱,退款成功,4200005,m5,/
`

const ALIPAY = `支付宝交易记录明细查询
账号:[test]
---------------------------------交易记录明细列表------------------------------------
交易号,商家订单号,交易创建时间,付款时间,最近修改时间,交易来源地,类型,交易分类,交易对方,商品名称,金额（元）,收/支,交易状态,服务费（元）,成功退款（元）,备注,资金状态
20260901112233,SHOP1,2026-09-01 11:22:33,2026-09-01 11:22:40,2026-09-01 11:22:40,其他,即时到账交易,餐饮美食,某商户,商品A,100.00,支出,交易成功,0.00,30.00,,
20260902112233,SHOP2,2026-09-02 11:22:33,2026-09-02 11:22:40,2026-09-02 11:22:40,其他,即时到账交易,交通出行,某商户,商品B,50.00,支出,交易关闭,0.00,0.00,,
`

const QIANJI = `钱迹导出
时间,类型,金额,分类,账户,备注,标签
2026-09-01 08:00,支出,12.50,餐饮/早餐,微信,包子,早餐
2026-09-02 09:00,收入,5000.00,工资,招商银行,九月工资,固定收入
`

function parse(text: string) {
  const table = buildTable(cleanRows(parseCsv(text)))
  assert.ok(table, 'expected a header row')
  const matches = detectAdapters(table, text)
  assert.ok(matches.length > 0, 'expected at least one adapter')
  return { table, adapter: matches[0].adapter, matches }
}

function testCsvBasics() {
  const rows = parseCsv('a,b\r\n"x,1","y""z"\r\n1,2')
  assert.deepEqual(rows, [
    ['a', 'b'],
    ['x,1', 'y"z'],
    ['1', '2'],
  ])

  assert.equal(parseAmountCents('¥1,234.56'), 123456)
  assert.equal(parseAmountCents('-12.5'), -1250)
  assert.equal(parseAmountCents('(8.00)'), -800)
  assert.equal(parseAmountCents('abc'), null)

  assert.deepEqual(parseDateValue('2026/9/1 08:30:00'), {
    date: '2026-09-01',
    time: '08:30',
  })
  assert.deepEqual(parseDateValue('2026年9月1日'), {
    date: '2026-09-01',
    time: '',
  })
  assert.deepEqual(parseDateValue('20260901'), {
    date: '2026-09-01',
    time: '',
  })
  assert.equal(parseDateValue('2026-13-01'), null)
}

function testDecode() {
  const utf8 = new TextEncoder().encode('微信支付账单')
  const decoded = decodeBytes(utf8)
  assert.equal(decoded.encoding, 'utf-8')
  assert.equal(decoded.text, '微信支付账单')

  const withBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x2c, 0x62])
  assert.equal(decodeBytes(withBom).text, 'a,b')
}

function testWechat() {
  const { table, adapter, matches } = parse(WECHAT)
  assert.equal(adapter.id, 'wechat')
  assert.ok(matches[0].confidence >= 0.9)

  const result = adapter.parse(table, WECHAT)
  assert.equal(result.rows.length, 5)
  assert.equal(result.rows[0].direction, 'expense')
  assert.equal(result.rows[0].amountCents, 3200)
  assert.equal(result.rows[0].accountName, '零钱')
  assert.equal(result.rows[0].categoryName, '')
  assert.match(result.rows[0].note, /星巴克/)
  assert.match(result.rows[0].note, /拿铁/)
  assert.equal(result.rows[0].externalId, '4200001')

  assert.equal(result.rows[1].direction, 'income')
  assert.equal(result.rows[2].direction, 'transfer')
  assert.equal(result.rows[4].direction, 'refund')

  // 交易对方/商品 are folded into the note, not duplicated in the extension.
  assert.equal(result.rows[0].extra['交易对方'], undefined)
  assert.equal(result.rows[0].extra['商品'], undefined)
  assert.ok(result.rows[0].extra['商户单号'])
}

function testAlipayRefund() {
  const { table, adapter, matches } = parse(ALIPAY)
  assert.equal(adapter.id, 'alipay')
  assert.ok(matches[0].confidence >= 0.9)

  const result = adapter.parse(table, ALIPAY)
  // One expense, one synthetic partial refund; the closed row is skipped.
  assert.equal(result.rows.length, 2)
  assert.equal(result.skipped.length, 1)
  assert.match(result.skipped[0].reason, /关闭/)
  assert.equal(result.rows[0].direction, 'expense')
  assert.equal(result.rows[0].amountCents, 10000)
  // A real category column is kept instead of being flattened to 其他.
  assert.equal(result.rows[0].categoryName, '餐饮美食')
  assert.equal(result.rows[1].direction, 'refund')
  assert.equal(result.rows[1].amountCents, 3000)
  assert.equal(result.rows[1].externalId, '20260901112233-refund')
}

function testQianji() {
  const { table, adapter } = parse(QIANJI)
  assert.equal(adapter.id, 'qianji')

  const result = adapter.parse(table, QIANJI)
  assert.equal(result.rows.length, 2)
  assert.equal(result.rows[0].date, '2026-09-01')
  assert.equal(result.rows[0].categoryName, '餐饮/早餐')
  assert.equal(result.rows[0].accountName, '微信')
  assert.equal(result.rows[0].amountCents, 1250)
  assert.deepEqual(result.rows[0].tags, ['早餐'])
  assert.equal(result.rows[1].direction, 'income')

  // A path whose child does not exist yet keeps its parent.
  assert.deepEqual(matchCategory('餐饮/早餐', 'expense', DEFAULT_CATEGORIES), {
    kind: 'create',
    name: '早餐',
    parentId: 'food',
  })
  // Existing child names still map straight to the child.
  assert.deepEqual(matchCategory('餐饮/饮料奶茶', 'expense', DEFAULT_CATEGORIES), {
    kind: 'existing',
    id: 'food-drink',
  })
}

function testMarkerNeedsPreamble() {
  const text = `日期,金额,备注,账户
2026-09-01,10,微信支付账单是一首歌,微信
2026-09-02,20,支付宝交易记录截图,支付宝
`
  const { matches } = parse(text)
  assert.equal(matches[0].adapter.id, 'csv')
  assert.equal(matches.some((match) => match.adapter.id === 'wechat'), false)
  assert.equal(matches.some((match) => match.adapter.id === 'alipay'), false)
}

function testPlanAndDedupe() {
  const { table, adapter } = parse(WECHAT)
  const parsed = adapter.parse(table, WECHAT)

  assert.equal(ADAPTERS.length >= 9, true)
  assert.equal(getAdapter('missing').id, 'csv')

  const categoryChoices = suggestCategoryChoices(parsed.rows, DEFAULT_CATEGORIES)
  const accountChoices = suggestAccountChoices(
    parsed.rows,
    DEFAULT_ACCOUNTS,
    'wechat',
  )

  const plan = buildImportPlan(
    parsed.rows,
    categoryChoices,
    accountChoices,
    { skipDuplicates: true, skipTransfers: true },
    {
      categories: DEFAULT_CATEGORIES,
      accounts: DEFAULT_ACCOUNTS,
      existing: [],
      sourceId: adapter.id,
      batchId: 'batch-1',
    },
  )

  assert.equal(plan.transactions.length, 4)
  assert.equal(plan.skippedTransfer, 1)
  assert.equal(plan.skippedDuplicate, 0)
  const refund = plan.transactions.find((item) => item.kind === 'refund')
  assert.ok(refund, 'expected the refund row')
  assert.equal(refund?.importMeta?.externalId, '4200005')
  assert.ok(
    plan.transactions.every(
      (item) => item.importMeta?.batchId === 'batch-1',
    ),
  )
  assert.ok(
    plan.transactions.every(
      (item) => item.allocations.reduce((sum, line) => sum + line.amountCents, 0) === item.amountCents,
    ),
  )

  const second = buildImportPlan(
    parsed.rows,
    categoryChoices,
    accountChoices,
    { skipDuplicates: true, skipTransfers: true },
    {
      categories: DEFAULT_CATEGORIES,
      accounts: DEFAULT_ACCOUNTS,
      existing: plan.transactions,
      sourceId: adapter.id,
      batchId: 'batch-2',
    },
  )
  assert.equal(second.transactions.length, 0)
  assert.equal(second.skippedDuplicate, 4)
  assert.equal(second.batchId, 'batch-2')

  const remaining = removeImportBatch(plan.transactions, 'batch-1')
  assert.equal(remaining.length, 0)
  assert.equal(
    plan.transactions[0].importMeta?.fingerprint,
    transactionFingerprint(plan.transactions[0]),
  )
}

function testTemplates() {
  const { table, adapter } = parse(QIANJI)
  const parsed = adapter.parse(table, QIANJI)
  const categoryChoices = suggestCategoryChoices(parsed.rows, DEFAULT_CATEGORIES)
  const accountChoices = suggestAccountChoices(
    parsed.rows,
    DEFAULT_ACCOUNTS,
    'cash',
  )

  const template = buildTemplate({
    name: '钱迹模板',
    sourceId: 'qianji',
    mapping: {
      date: '时间',
      amount: '金额',
      direction: '类型',
      category: '分类',
      account: '账户',
      note: '备注',
      tags: '标签',
    },
    categoryChoices,
    accountChoices,
    id: 'tpl-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  assert.equal(template.id, 'tpl-1')
  assert.equal(template.name, '钱迹模板')
  assert.equal(template.mapping.date, '时间')
  // Fields the template does not use are stored explicitly as "".
  assert.equal(template.mapping.externalId, '')
  assert.deepEqual(template.categories['expense|餐饮/早餐'], {
    kind: 'create',
    name: '早餐',
    parentId: 'food',
  })

  // Column names are matched loosely and replaced with the new file's spelling.
  assert.deepEqual(
    mappingForHeaders(
      { date: '交易 时间', amount: '金额', note: '不存在', tags: '' },
      ['交易时间', '金额', '备注'],
    ),
    { date: '交易时间', amount: '金额', tags: '' },
  )

  // An existing id that has since been deleted falls back to a suggestion.
  assert.deepEqual(
    applyCategoryTargets(
      [
        {
          key: 'expense|餐饮/早餐',
          type: 'expense',
          sourceName: '餐饮/早餐',
          count: 1,
          target: { kind: 'skip' },
        },
      ],
      { 'expense|餐饮/早餐': { kind: 'existing', id: 'deleted' } },
      DEFAULT_CATEGORIES,
    )[0].target,
    { kind: 'create', name: '早餐', parentId: 'food' },
  )

  // A parent that no longer exists is dropped, the child is still created.
  assert.deepEqual(
    applyCategoryTargets(
      [
        {
          key: 'expense|旧/新',
          type: 'expense',
          sourceName: '旧/新',
          count: 1,
          target: { kind: 'skip' },
        },
      ],
      { 'expense|旧/新': { kind: 'create', name: '新', parentId: 'deleted' } },
      DEFAULT_CATEGORIES,
    )[0].target,
    { kind: 'create', name: '新' },
  )

  // A deleted account id also degrades to a new account, never to a bad id.
  const accounts = applyAccountTargets(
    [
      {
        key: '__default__',
        sourceName: '',
        count: 1,
        target: { kind: 'skip' },
      },
    ],
    { __default__: { kind: 'existing', id: 'deleted' } },
    DEFAULT_ACCOUNTS,
  )
  assert.equal(accounts[0].target.kind, 'create')

  // Saving under the same name updates the existing template in place.
  const { templates, saved } = upsertTemplate([template], {
    ...template,
    name: '钱迹模板',
    mapping: {},
  })
  assert.equal(templates.length, 1)
  assert.equal(saved.id, 'tpl-1')
  assert.equal(saved.createdAt, '2026-01-01T00:00:00.000Z')
  assert.deepEqual(saved.mapping, {})
}

function testExportRoundTrip() {
  const { table, adapter } = parse(WECHAT)
  const parsed = adapter.parse(table, WECHAT)
  const categoryChoices = suggestCategoryChoices(parsed.rows, DEFAULT_CATEGORIES)
  const accountChoices = suggestAccountChoices(
    parsed.rows,
    DEFAULT_ACCOUNTS,
    'wechat',
  )
  const plan = buildImportPlan(
    parsed.rows,
    categoryChoices,
    accountChoices,
    { skipDuplicates: true, skipTransfers: true },
    {
      categories: DEFAULT_CATEGORIES,
      accounts: DEFAULT_ACCOUNTS,
      existing: [],
      sourceId: adapter.id,
      batchId: 'batch-export',
    },
  )
  plan.transactions[0].spendingNature = 'essential'

  const csv = transactionsToExchangeCsv(
    plan.transactions,
    [...DEFAULT_CATEGORIES, ...plan.newCategories],
    [...DEFAULT_ACCOUNTS, ...plan.newAccounts],
    [],
  )
  assert.match(csv, /账页扩展/)

  const table2 = buildTable(cleanRows(parseCsv(csv)))
  assert.ok(table2)
  assert.equal(detectHeaders(table2).mapping.direction, '类型')
  const generic = getAdapter('csv')
  const reparsed = generic.parse(table2, csv)
  assert.equal(reparsed.rows.length, plan.transactions.length)
  assert.equal(reparsed.rows[0].amountCents, plan.transactions[0].amountCents)
  assert.equal(reparsed.rows[0].zhangye?.spendingNature, 'essential')
  const refundRow = reparsed.rows.find((row) => row.direction === 'refund')
  assert.ok(refundRow)
}

testCsvBasics()
testDecode()
testWechat()
testAlipayRefund()
testQianji()
testMarkerNeedsPreamble()
testPlanAndDedupe()
testTemplates()
testExportRoundTrip()

console.log('exchange tests passed')
