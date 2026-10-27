/**
 * Standalone checks for the storage housekeeping. Run with:
 *   npm run test:storage
 */
import assert from 'node:assert/strict'
import type { Account } from '../src/types'
import {
  buildPendingCapture,
  loadInboxState,
  mergePendingCapture,
  pruneInbox,
  saveInboxState,
} from '../src/lib/capture/pending'
import type {
  CaptureEventRecord,
  PendingCapture,
} from '../src/lib/capture/types'

const DAY = 24 * 60 * 60 * 1000
const now = new Date().toISOString()
const accounts: Account[] = [{ id: 'wechat', name: '微信', type: 'wechat' }]

function item(overrides: Partial<PendingCapture> = {}): PendingCapture {
  return {
    id: `capture-${Math.random().toString(16).slice(2)}`,
    status: 'pending',
    direction: 'expense',
    amountCents: 1234,
    date: '2026-10-20',
    occurredAt: Date.now(),
    merchant: '测试商户',
    accountId: 'wechat',
    accountLabel: '微信',
    cardTail: '',
    confidence: 'high',
    issues: [],
    sources: [
      {
        packageName: 'com.tencent.mm',
        appLabel: '微信',
        title: '微信支付',
        text: '支付成功',
        postedAt: Date.now(),
      },
    ],
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

function event(overrides: Partial<CaptureEventRecord> = {}): CaptureEventRecord {
  return {
    id: `event-${Math.random().toString(16).slice(2)}`,
    packageName: 'com.tencent.mm',
    appLabel: '微信',
    title: '微信支付',
    text: '支付成功 ¥12.34',
    bigText: '',
    subText: '',
    postedAt: Date.now(),
    capturedAt: Date.now(),
    key: 'notice',
    ...overrides,
  }
}

function testResolvedRetention() {
  const fresh = new Date(Date.now() - 2 * DAY).toISOString()
  const old = new Date(Date.now() - 30 * DAY).toISOString()
  const result = pruneInbox([
    item({ id: 'pending-old', status: 'pending', updatedAt: old }),
    item({ id: 'ignored-new', status: 'ignored', updatedAt: fresh }),
    item({ id: 'ignored-old', status: 'ignored', updatedAt: old }),
  ])
  const ids = result.map((entry) => entry.id)
  assert.ok(ids.includes('pending-old'))
  assert.ok(ids.includes('ignored-new'))
  assert.ok(!ids.includes('ignored-old'))
}

function testResolvedEvidenceIsDropped() {
  const result = pruneInbox([
    item({ id: 'ignored', status: 'ignored', updatedAt: new Date().toISOString() }),
  ])
  assert.equal(result[0].sources[0].text, '')
  assert.ok(result[0].sources[0].title.length > 0)
}

function testPendingCountCap() {
  const items = Array.from({ length: 240 }, (_, index) =>
    item({
      id: `pending-${index}`,
      occurredAt: Date.now() - index * 1000,
    }),
  )
  const result = pruneInbox(items)
  assert.equal(result.length, 200)
  assert.ok(result.some((entry) => entry.id === 'pending-0'))
  assert.ok(!result.some((entry) => entry.id === 'pending-239'))
}

function testNewItemsAreClamped() {
  const built = buildPendingCapture(
    event({ bigText: 'x'.repeat(1500) }),
    accounts,
  )
  assert.equal(built.sources[0].text.length, 500)
  assert.equal('rawText' in built, false)
}

function testMergedItemsHaveNoDuplicateText() {
  const merged = mergePendingCapture(
    [item({ id: 'first' })],
    item({
      id: 'second',
      sources: [
        {
          packageName: 'com.android.bank',
          appLabel: '银行',
          title: '动账通知',
          text: '支出 12.34',
          postedAt: Date.now(),
        },
      ],
    }),
  )
  assert.equal(merged.merged, true)
  assert.equal(merged.items[0].sources.length, 2)
  assert.equal('rawText' in merged.items[0], false)
}

function testLegacyInboxIsNormalised() {
  const storage = new Map<string, string>()
  const fakeLocalStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size
    },
  }
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: fakeLocalStorage },
  })

  const legacy = {
    ...item({ id: 'legacy', status: 'ignored', updatedAt: new Date().toISOString() }),
    rawText: '整条通知的重复副本 '.repeat(20),
  }
  storage.set(
    'zhangye.captureInbox.v1',
    JSON.stringify({
      version: 1,
      items: [legacy],
      seenEventIds: ['event-1'],
      updatedAt: now,
    }),
  )

  const state = loadInboxState()
  assert.equal(state.items.length, 1)
  assert.equal('rawText' in state.items[0], false)
  assert.equal(state.items[0].sources[0].text, '')

  saveInboxState(state)
  const written = storage.get('zhangye.captureInbox.v1') ?? ''
  assert.ok(!written.includes('rawText'))
  assert.ok(!written.includes('重复副本'))
}

function main() {
  testResolvedRetention()
  testResolvedEvidenceIsDropped()
  testPendingCountCap()
  testNewItemsAreClamped()
  testMergedItemsHaveNoDuplicateText()
  testLegacyInboxIsNormalised()
  console.log('storage checks passed')
}

main()
