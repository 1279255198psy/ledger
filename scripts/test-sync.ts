/**
 * Standalone checks for the sync core. Run with:
 *   npx esbuild scripts/test-sync.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/sync-test.mjs && node node_modules/.cache/sync-test.mjs
 */
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import {
  decryptPayload,
  deriveSyncKey,
  encryptPayload,
  generateSyncCode,
  isValidSyncCode,
  normalizeSyncCode,
} from '../src/lib/sync/crypto'
import { mergeSnapshots, snapshotsEqual } from '../src/lib/sync/merge'
import type {
  LedgerDataSnapshot,
  SyncPayload,
} from '../src/lib/sync/types'

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto })
}
if (!globalThis.btoa) {
  globalThis.btoa = (value: string) =>
    Buffer.from(value, 'binary').toString('base64')
  globalThis.atob = (value: string) =>
    Buffer.from(value, 'base64').toString('binary')
}

const now = '2026-10-24T10:00:00.000Z'

function snapshot(partial: Partial<LedgerDataSnapshot> = {}): LedgerDataSnapshot {
  return {
    app: '账页',
    syncVersion: 1,
    updatedAt: now,
    categories: [
      { id: 'expense', type: 'expense', name: '支出', color: '#000', icon: 'x' },
      { id: 'income', type: 'income', name: '收入', color: '#000', icon: 'x' },
      { id: 'other_expense', type: 'expense', name: '其他', color: '#000', icon: 'x' },
      { id: 'other_income', type: 'income', name: '其他', color: '#000', icon: 'x' },
    ],
    transactions: [],
    projects: [],
    liabilities: [],
    budgets: {},
    budgetRanges: [],
    openingBalanceCents: 0,
    ...partial,
  }
}

function transaction(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    type: 'expense',
    amountCents: 1000,
    categoryId: 'expense',
    note: id,
    date: '2026-10-20',
    createdAt: '2026-10-20T09:00:00.000Z',
    updatedAt: '2026-10-20T09:00:00.000Z',
    allocations: [],
    ...patch,
  }
}

function testAdditiveMerge() {
  const base = snapshot()
  const local = snapshot({
    transactions: [transaction('a', { note: 'phone' })],
    openingBalanceCents: 100,
  })
  const remote = snapshot({
    transactions: [transaction('b', { note: 'pc' })],
    openingBalanceCents: 100,
  })
  const result = mergeSnapshots(base, local, remote)
  assert.equal(result.snapshot.transactions.length, 2)
  assert.equal(result.stats.added, 2)
  assert.equal(result.snapshot.openingBalanceCents, 100)
}

function testDeletionPropagates() {
  const base = snapshot({ transactions: [transaction('a'), transaction('b')] })
  const local = snapshot({ transactions: [transaction('a')] }) // deleted b
  const remote = snapshot({ transactions: [transaction('a'), transaction('b')] })
  const result = mergeSnapshots(base, local, remote)
  assert.deepEqual(
    result.snapshot.transactions.map((item) => item.id),
    ['a'],
  )
  assert.equal(result.stats.removed, 1)

  const reverse = mergeSnapshots(base, remote, local)
  assert.ok(snapshotsEqual(result.snapshot, reverse.snapshot))
}

function testEditBeatsDelete() {
  const base = snapshot({ transactions: [transaction('a')] })
  const local = snapshot() // deleted here
  const remote = snapshot({
    transactions: [transaction('a', { note: 'edited', updatedAt: '2026-10-21T00:00:00.000Z' })],
  })
  const result = mergeSnapshots(base, local, remote)
  assert.equal(result.snapshot.transactions.length, 1)
  assert.equal(result.snapshot.transactions[0].note, 'edited')
  assert.ok(result.conflicts.some((item) => item.kind === 'transaction'))
}

function testConcurrentEditsConverge() {
  const base = snapshot({ transactions: [transaction('a')] })
  const local = snapshot({
    transactions: [
      transaction('a', { note: 'phone', updatedAt: '2026-10-21T00:00:00.000Z' }),
    ],
  })
  const remote = snapshot({
    transactions: [
      transaction('a', { note: 'pc', updatedAt: '2026-10-22T00:00:00.000Z' }),
    ],
  })
  const phone = mergeSnapshots(base, local, remote)
  const desktop = mergeSnapshots(base, remote, local)
  assert.ok(snapshotsEqual(phone.snapshot, desktop.snapshot))
  assert.equal(phone.snapshot.transactions[0].note, 'pc')
  assert.ok(phone.conflicts.some((item) => item.kind === 'transaction'))
}

function testConnectionPriorityOverridesEditTime() {
  const base = snapshot({ transactions: [transaction('a')] })
  const local = snapshot({
    transactions: [
      transaction('a', { note: 'phone', updatedAt: '2026-10-21T00:00:00.000Z' }),
    ],
  })
  const remote = snapshot({
    transactions: [
      transaction('a', { note: 'pc', updatedAt: '2026-10-23T00:00:00.000Z' }),
    ],
  })

  // Without a priority the newer edit (the computer's) wins.
  assert.equal(
    mergeSnapshots(base, local, remote).snapshot.transactions[0].note,
    'pc',
  )
  // "Phone first" wins even though its edit is older.
  assert.equal(
    mergeSnapshots(base, local, remote, { favor: 'local' }).snapshot
      .transactions[0].note,
    'phone',
  )
  assert.equal(
    mergeSnapshots(base, local, remote, { favor: 'remote' }).snapshot
      .transactions[0].note,
    'pc',
  )

  // A delete on the favored side must not silently discard an edit elsewhere.
  const deleted = snapshot()
  const edited = snapshot({
    transactions: [
      transaction('a', { note: 'kept', updatedAt: '2026-10-25T00:00:00.000Z' }),
    ],
  })
  const kept = mergeSnapshots(base, deleted, edited, { favor: 'local' })
  assert.equal(kept.snapshot.transactions.length, 1)
  assert.equal(kept.snapshot.transactions[0].note, 'kept')
}

function testOpeningBalanceFollowsPriority() {
  const base = snapshot({ openingBalanceCents: 1000 })
  const local = snapshot({ openingBalanceCents: 2000 })
  const remote = snapshot({ openingBalanceCents: 3000 })
  assert.equal(
    mergeSnapshots(base, local, remote, { favor: 'local' }).snapshot
      .openingBalanceCents,
    2000,
  )
  assert.equal(
    mergeSnapshots(base, local, remote, { favor: 'remote' }).snapshot
      .openingBalanceCents,
    3000,
  )
}

function testEqualStampTieBreakConverges() {
  const base = snapshot({ transactions: [transaction('a')] })
  const local = snapshot({
    transactions: [transaction('a', { note: 'alpha', amountCents: 1 })],
  })
  const remote = snapshot({
    transactions: [transaction('a', { note: 'beta', amountCents: 2 })],
  })
  const first = mergeSnapshots(base, local, remote)
  const second = mergeSnapshots(base, remote, local)
  assert.ok(snapshotsEqual(first.snapshot, second.snapshot))
}

function testIdempotent() {
  const base = snapshot()
  const local = snapshot({ transactions: [transaction('a')] })
  const remote = snapshot({ transactions: [transaction('b')] })
  const once = mergeSnapshots(base, local, remote).snapshot
  const twice = mergeSnapshots(once, once, once).snapshot
  assert.ok(snapshotsEqual(once, twice))
}

function testRepaymentMerge() {
  const liability = (repayments: { id: string; amountCents: number; date: string; createdAt: string }[]) => ({
    id: 'l1',
    name: '房贷',
    principalCents: 100000,
    direction: 'owed' as const,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    repayments,
  })
  const base = snapshot({ liabilities: [liability([])] })
  const local = snapshot({
    liabilities: [
      liability([
        { id: 'r1', amountCents: 100, date: '2026-10-21', createdAt: '2026-10-21T00:00:00.000Z' },
      ]),
    ],
  })
  const remote = snapshot({
    liabilities: [
      liability([
        { id: 'r2', amountCents: 200, date: '2026-10-22', createdAt: '2026-10-22T00:00:00.000Z' },
      ]),
    ],
  })
  const result = mergeSnapshots(base, local, remote)
  assert.deepEqual(
    result.snapshot.liabilities[0].repayments.map((item) => item.id).sort(),
    ['r1', 'r2'],
  )

  // Both sides recorded the same repayment: keep one.
  const same = mergeSnapshots(base, local, local)
  assert.equal(same.snapshot.liabilities[0].repayments.length, 1)
}

function testBudgetMerge() {
  const base = snapshot()
  const local = snapshot({
    budgets: {
      '2026-09': { month: '2026-09', amountCents: 1000, dailyCents: 0, updatedAt: '2026-10-01T00:00:00.000Z' },
    },
  })
  const remote = snapshot({
    budgets: {
      '2026-10': { month: '2026-10', amountCents: 2000, dailyCents: 0, updatedAt: '2026-10-01T00:00:00.000Z' },
    },
  })
  const result = mergeSnapshots(base, local, remote)
  assert.deepEqual(Object.keys(result.snapshot.budgets).sort(), ['2026-09', '2026-10'])

  const edited = mergeSnapshots(
    snapshot({
      budgets: {
        '2026-09': { month: '2026-09', amountCents: 1000, dailyCents: 0, updatedAt: '2026-10-01T00:00:00.000Z' },
      },
    }),
    snapshot({
      budgets: {
        '2026-09': { month: '2026-09', amountCents: 5000, dailyCents: 0, updatedAt: '2026-10-03T00:00:00.000Z' },
      },
    }),
    snapshot({
      budgets: {
        '2026-09': { month: '2026-09', amountCents: 1000, dailyCents: 0, updatedAt: '2026-10-01T00:00:00.000Z' },
      },
    }),
  )
  assert.equal(edited.snapshot.budgets['2026-09'].amountCents, 5000)
}

function testReferenceRepair() {
  // The phone added a transaction under a category the desktop just deleted.
  const custom = { id: 'custom', type: 'expense', name: '装修', color: '#000', icon: 'x' }
  const base = snapshot({ categories: [...snapshot().categories, custom] })
  const local = snapshot({
    categories: [...snapshot().categories, custom],
    transactions: [transaction('t', { categoryId: 'custom' })],
  })
  const remote = snapshot()
  const result = mergeSnapshots(base, local, remote)
  assert.ok(
    result.snapshot.categories.some((item) => item.id === 'custom'),
    'a category the other side deleted must be restored while still referenced',
  )
  assert.ok(result.conflicts.some((item) => item.kind === 'reference'))

  // Nothing anywhere references a known category: fall back, never orphan.
  const fallback = mergeSnapshots(
    snapshot(),
    snapshot(),
    snapshot({
      transactions: [transaction('t', { categoryId: 'deleted_category' })],
    }),
  )
  assert.equal(fallback.snapshot.transactions[0].categoryId, 'other_expense')
}

async function testCrypto() {
  const code = generateSyncCode()
  assert.ok(isValidSyncCode(code), 'generated codes validate')
  assert.equal(normalizeSyncCode('ilo-u'), '110V')
  assert.equal(normalizeSyncCode('abcd-efgh-ij'), 'ABCDEFGH1J')

  const key = await deriveSyncKey(code)
  const payload: SyncPayload = {
    v: 1,
    sender: 'mobile',
    deviceId: 'device-1',
    pairingId: 'pair-1',
    seq: 3,
    sentAt: now,
    mode: 'snapshot',
    priority: 'phone',
    snapshot: snapshot({ transactions: [transaction('a')] }),
  }
  const envelope = await encryptPayload(payload, key)
  assert.notEqual(envelope.data, JSON.stringify(payload))
  const decrypted = await decryptPayload(envelope, key)
  assert.deepEqual(decrypted, payload)

  const otherKey = await deriveSyncKey(generateSyncCode())
  await assert.rejects(() => decryptPayload(envelope, otherKey))
  await assert.rejects(() => decryptPayload({ ...envelope, data: 'AAAA' }, key))
}

async function main() {
  testAdditiveMerge()
  testDeletionPropagates()
  testEditBeatsDelete()
  testConcurrentEditsConverge()
  testConnectionPriorityOverridesEditTime()
  testOpeningBalanceFollowsPriority()
  testEqualStampTieBreakConverges()
  testIdempotent()
  testRepaymentMerge()
  testBudgetMerge()
  testReferenceRepair()
  await testCrypto()
  console.log('sync core: all checks passed')
}

void main()
