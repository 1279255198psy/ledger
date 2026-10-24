import { DEFAULT_CATEGORIES } from '../categories'
import { sortTransactions } from '../data'
import { sortLiabilities } from '../liabilities'
import type {
  BudgetBook,
  Category,
  LedgerTransaction,
  Liability,
  LiabilityRepayment,
  MonthBudget,
  Project,
  RangeBudget,
} from '../../types'
import type {
  LedgerDataSnapshot,
  MergeResult,
  MergeStats,
  SyncConflict,
  SyncConflictKind,
} from './types'

interface MergeOptions<T extends { id: string }> {
  /** Used only to break ties; equal values fall back to a stable comparison. */
  stamp?: (item: T) => string
}

interface CollectionResult<T> {
  items: T[]
  conflicts: SyncConflict[]
  stats: MergeStats
}

/** JSON with sorted object keys, so record comparison is order-independent. */
export function stableStringify(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
    return `{${keys
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',')}}`
  }
  return JSON.stringify(value)
}

export function sameValue(left: unknown, right: unknown): boolean {
  return stableStringify(left) === stableStringify(right)
}

/** Everything that matters for "has this ledger changed", excluding the clock. */
export function snapshotFingerprint(snapshot: LedgerDataSnapshot): string {
  const { updatedAt: _updatedAt, ...rest } = snapshot
  return stableStringify(rest)
}

export function snapshotsEqual(
  left: LedgerDataSnapshot | null,
  right: LedgerDataSnapshot | null,
): boolean {
  if (!left || !right) return left === right
  return snapshotFingerprint(left) === snapshotFingerprint(right)
}

function stampOf(item: {
  updatedAt?: string
  createdAt?: string
}): string {
  return item.updatedAt ?? item.createdAt ?? ''
}

function keyed<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]))
}

function emptyStats(): MergeStats {
  return { added: 0, updated: 0, removed: 0 }
}

function addStats(target: MergeStats, source: MergeStats): void {
  target.added += source.added
  target.updated += source.updated
  target.removed += source.removed
}

function chooseBothChanged<T>(
  local: T,
  remote: T,
  stamp: ((item: T) => string) | undefined,
): 'local' | 'remote' {
  if (stamp) {
    const localStamp = stamp(local)
    const remoteStamp = stamp(remote)
    if (localStamp !== remoteStamp) {
      return localStamp > remoteStamp ? 'local' : 'remote'
    }
  }
  // Deterministic on both devices, so a concurrent edit converges instead of
  // flipping back and forth on every sync.
  return stableStringify(local) >= stableStringify(remote) ? 'local' : 'remote'
}

/**
 * Three-way merge for a collection with stable ids.
 *
 * Deletions are inferred from the base snapshot instead of tombstones:
 * - only in base → deleted on both sides, drop
 * - in base and one side, unchanged there → the other side deleted it, drop
 * - in base and one side, edited there → edit vs delete, keep the edit
 */
function mergeCollection<T extends { id: string }>(
  baseItems: T[] | null,
  localItems: T[],
  remoteItems: T[],
  kind: SyncConflictKind,
  options: MergeOptions<T> = {},
): CollectionResult<T> {
  const base = baseItems ? keyed(baseItems) : null
  const local = keyed(localItems)
  const remote = keyed(remoteItems)
  const ids: string[] = []
  const seen = new Set<string>()
  for (const item of localItems) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      ids.push(item.id)
    }
  }
  for (const item of remoteItems) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      ids.push(item.id)
    }
  }
  if (baseItems) {
    for (const item of baseItems) {
      if (!seen.has(item.id)) {
        seen.add(item.id)
        ids.push(item.id)
      }
    }
  }

  const items: T[] = []
  const conflicts: SyncConflict[] = []
  const stats = emptyStats()

  for (const id of ids) {
    const baseItem = base?.get(id)
    const localItem = local.get(id)
    const remoteItem = remote.get(id)
    let chosen: T | undefined

    if (localItem && remoteItem) {
      if (sameValue(localItem, remoteItem)) {
        chosen = localItem
      } else if (baseItem && sameValue(localItem, baseItem)) {
        chosen = remoteItem
      } else if (baseItem && sameValue(remoteItem, baseItem)) {
        chosen = localItem
      } else {
        const side = chooseBothChanged(localItem, remoteItem, options.stamp)
        chosen = side === 'local' ? localItem : remoteItem
        conflicts.push({ kind, id, choice: side })
      }
    } else if (localItem) {
      if (!baseItem) {
        chosen = localItem
      } else if (sameValue(localItem, baseItem)) {
        // The other device deleted it; the local copy is unchanged.
        chosen = undefined
      } else {
        // Edited here, deleted there: never lose the edit silently.
        chosen = localItem
        conflicts.push({ kind, id, choice: 'local' })
      }
    } else if (remoteItem) {
      if (!baseItem) {
        chosen = remoteItem
      } else if (sameValue(remoteItem, baseItem)) {
        // Deleted here, unchanged there.
        chosen = undefined
      } else {
        // Deleted here, edited there: keep the remote edit.
        chosen = remoteItem
        conflicts.push({ kind, id, choice: 'remote' })
      }
    }

    if (!chosen) {
      if (baseItem) stats.removed += 1
      continue
    }
    if (!baseItem) {
      stats.added += 1
    } else if (!sameValue(chosen, baseItem)) {
      stats.updated += 1
    }
    items.push(chosen)
  }

  return { items, conflicts, stats }
}

function stripRepayments(liability: Liability): Liability {
  return { ...liability, repayments: [] }
}

function mergeLiabilities(
  baseItems: Liability[] | null,
  localItems: Liability[],
  remoteItems: Liability[],
): CollectionResult<Liability> {
  const base = baseItems ? keyed(baseItems) : null
  const local = keyed(localItems)
  const remote = keyed(remoteItems)
  const ids = new Set<string>([
    ...localItems.map((item) => item.id),
    ...remoteItems.map((item) => item.id),
    ...(baseItems ?? []).map((item) => item.id),
  ])

  const items: Liability[] = []
  const conflicts: SyncConflict[] = []
  const stats = emptyStats()

  for (const id of ids) {
    const baseItem = base?.get(id)
    const localItem = local.get(id)
    const remoteItem = remote.get(id)

    if (localItem && remoteItem) {
      const repayments = mergeCollection<LiabilityRepayment>(
        baseItem?.repayments ?? null,
        localItem.repayments,
        remoteItem.repayments,
        'repayment',
        { stamp: stampOf },
      )
      conflicts.push(...repayments.conflicts)

      const localMain = stripRepayments(localItem)
      const remoteMain = stripRepayments(remoteItem)
      const baseMain = baseItem ? stripRepayments(baseItem) : undefined
      let main: Liability
      if (sameValue(localMain, remoteMain)) {
        main = localMain
      } else if (baseMain && sameValue(localMain, baseMain)) {
        main = remoteMain
      } else if (baseMain && sameValue(remoteMain, baseMain)) {
        main = localMain
      } else {
        const side = chooseBothChanged(localItem, remoteItem, stampOf)
        main = side === 'local' ? localMain : remoteMain
        conflicts.push({ kind: 'liability', id, choice: side })
      }

      const merged: Liability = {
        ...main,
        repayments: repayments.items,
        updatedAt:
          localItem.updatedAt >= remoteItem.updatedAt
            ? localItem.updatedAt
            : remoteItem.updatedAt,
      }
      if (!baseItem) stats.added += 1
      else if (!sameValue(merged, baseItem)) stats.updated += 1
      items.push(merged)
    } else if (localItem) {
      if (!baseItem) {
        items.push(localItem)
        stats.added += 1
      } else if (sameValue(localItem, baseItem)) {
        stats.removed += 1
      } else {
        items.push(localItem)
        stats.updated += 1
        conflicts.push({ kind: 'liability', id, choice: 'local' })
      }
    } else if (remoteItem) {
      if (!baseItem) {
        items.push(remoteItem)
        stats.added += 1
      } else if (sameValue(remoteItem, baseItem)) {
        stats.removed += 1
      } else {
        items.push(remoteItem)
        stats.updated += 1
        conflicts.push({ kind: 'liability', id, choice: 'remote' })
      }
    } else if (baseItem) {
      stats.removed += 1
    }
  }

  return { items, conflicts, stats }
}

interface BudgetEntry extends MonthBudget {
  id: string
}

function toBudgetEntries(book: BudgetBook | null): BudgetEntry[] {
  if (!book) return []
  return Object.values(book).map((budget) => ({ ...budget, id: budget.month }))
}

function fromBudgetEntries(entries: BudgetEntry[]): BudgetBook {
  const book: BudgetBook = {}
  for (const entry of entries) {
    const { id: _id, ...budget } = entry
    book[budget.month] = budget
  }
  return book
}

/**
 * Repairs references that a merge can strand: a category deleted on one device
 * while the other added a transaction using it, a project allocation whose
 * project disappeared, or a subcategory whose parent was removed. Keeping the
 * referenced record is safer than silently losing money that points at it.
 */
function repairReferences(
  snapshot: LedgerDataSnapshot,
  sources: Array<LedgerDataSnapshot | null>,
  conflicts: SyncConflict[],
): void {
  const categoryById = new Map(
    snapshot.categories.map((category) => [category.id, category]),
  )
  const findCategory = (id: string): Category | undefined => {
    for (const source of sources) {
      const found = source?.categories.find((category) => category.id === id)
      if (found) return found
    }
    return undefined
  }
  const addCategory = (category: Category): void => {
    if (!categoryById.has(category.id)) {
      categoryById.set(category.id, category)
      snapshot.categories.push(category)
    }
  }

  // Categories directly referenced by transactions and project caps.
  for (const transaction of snapshot.transactions) {
    if (categoryById.has(transaction.categoryId)) continue
    const rescued = findCategory(transaction.categoryId)
    if (rescued) {
      addCategory(rescued)
      conflicts.push({
        kind: 'reference',
        id: transaction.categoryId,
        choice: 'remote',
      })
      continue
    }
    const fallback =
      snapshot.categories.find(
        (category) =>
          category.id ===
          (transaction.type === 'expense'
            ? 'other_expense'
            : 'other_income'),
      ) ??
      snapshot.categories.find(
        (category) =>
          category.type === transaction.type && !category.parentId,
      )
    if (fallback) {
      transaction.categoryId = fallback.id
      transaction.updatedAt = new Date().toISOString()
      conflicts.push({ kind: 'reference', id: transaction.id, choice: 'local' })
    }
  }

  for (const project of snapshot.projects) {
    for (const categoryId of Object.keys(project.categoryBudgetsCents ?? {})) {
      if (categoryById.has(categoryId)) continue
      const rescued = findCategory(categoryId)
      if (rescued) {
        addCategory(rescued)
        conflicts.push({ kind: 'reference', id: categoryId, choice: 'remote' })
      } else if (project.categoryBudgetsCents) {
        delete project.categoryBudgetsCents[categoryId]
        project.updatedAt = new Date().toISOString()
        conflicts.push({
          kind: 'reference',
          id: project.id,
          choice: 'local',
        })
      }
    }
  }

  // Subcategories need their parent, and every book needs a top-level category
  // of each type for normalization to accept the list.
  for (const category of [...snapshot.categories]) {
    if (!category.parentId || categoryById.has(category.parentId)) continue
    const rescued = findCategory(category.parentId)
    if (rescued) {
      addCategory(rescued)
    } else {
      delete category.parentId
    }
  }
  for (const type of ['expense', 'income'] as const) {
    const hasTopLevel = snapshot.categories.some(
      (category) => category.type === type && !category.parentId,
    )
    if (hasTopLevel) continue
    const fallback = DEFAULT_CATEGORIES.find(
      (category) => category.type === type && !category.parentId,
    )
    if (fallback) addCategory(fallback)
  }

  // Project allocations must point at a project that still exists.
  const projectIds = new Set(snapshot.projects.map((project) => project.id))
  const findProject = (id: string): Project | undefined => {
    for (const source of sources) {
      const found = source?.projects.find((project) => project.id === id)
      if (found) return found
    }
    return undefined
  }
  for (const transaction of snapshot.transactions) {
    for (const allocation of transaction.allocations) {
      if (allocation.targetType !== 'project' || !allocation.projectId) {
        continue
      }
      if (projectIds.has(allocation.projectId)) continue
      const rescued = findProject(allocation.projectId)
      if (rescued) {
        projectIds.add(rescued.id)
        snapshot.projects.push(rescued)
        conflicts.push({
          kind: 'reference',
          id: rescued.id,
          choice: 'remote',
        })
      }
    }
  }
}

export function mergeSnapshots(
  base: LedgerDataSnapshot | null,
  local: LedgerDataSnapshot,
  remote: LedgerDataSnapshot,
): MergeResult {
  const stats = emptyStats()
  const conflicts: SyncConflict[] = []

  const transactions = mergeCollection<LedgerTransaction>(
    base?.transactions ?? null,
    local.transactions,
    remote.transactions,
    'transaction',
    { stamp: stampOf },
  )
  const projects = mergeCollection<Project>(
    base?.projects ?? null,
    local.projects,
    remote.projects,
    'project',
    { stamp: stampOf },
  )
  const liabilities = mergeLiabilities(
    base?.liabilities ?? null,
    local.liabilities,
    remote.liabilities,
  )
  const categories = mergeCollection<Category>(
    base?.categories ?? null,
    local.categories,
    remote.categories,
    'category',
  )
  const budgets = mergeCollection<BudgetEntry>(
    base ? toBudgetEntries(base.budgets) : null,
    toBudgetEntries(local.budgets),
    toBudgetEntries(remote.budgets),
    'budget',
  )
  const ranges = mergeCollection<RangeBudget>(
    base?.budgetRanges ?? null,
    local.budgetRanges,
    remote.budgetRanges,
    'range',
  )

  for (const result of [
    transactions,
    projects,
    liabilities,
    categories,
    budgets,
    ranges,
  ]) {
    addStats(stats, result.stats)
    conflicts.push(...result.conflicts)
  }

  const localOpening = local.openingBalanceCents
  const remoteOpening = remote.openingBalanceCents
  const baseOpening = base?.openingBalanceCents
  let openingBalanceCents: number
  if (localOpening === remoteOpening) {
    openingBalanceCents = localOpening
  } else if (baseOpening !== undefined && localOpening === baseOpening) {
    openingBalanceCents = remoteOpening
  } else if (baseOpening !== undefined && remoteOpening === baseOpening) {
    openingBalanceCents = localOpening
  } else {
    openingBalanceCents = localOpening
    conflicts.push({
      kind: 'openingBalance',
      id: 'openingBalance',
      choice: 'local',
    })
  }

  const built: LedgerDataSnapshot = {
    app: '账页',
    syncVersion: 1,
    updatedAt: new Date().toISOString(),
    categories: categories.items,
    transactions: sortTransactions(transactions.items),
    projects: projects.items,
    liabilities: sortLiabilities(liabilities.items),
    budgets: fromBudgetEntries(budgets.items),
    budgetRanges: ranges.items,
    openingBalanceCents,
  }

  // Records are shared with the local/remote snapshots, and repair mutates
  // them. Clone first so a merge never edits its caller's books underneath it.
  const snapshot: LedgerDataSnapshot = JSON.parse(JSON.stringify(built))
  repairReferences(snapshot, [local, remote, base], conflicts)

  return { snapshot, conflicts, stats }
}
