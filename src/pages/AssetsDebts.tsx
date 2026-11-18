import { useState } from 'react'
import { PiggyBank, Scale, Wallet } from 'lucide-react'
import { Liabilities } from './Liabilities'
import { Savings } from './Savings'
import {
  getLiabilitySummary,
  getLiabilityTotals,
} from '../lib/liabilities'
import { getSavingsTotals } from '../lib/savings'
import type { GoalPlanContext } from '../lib/goalPlans'
import { formatMoney, formatSignedMoney } from '../lib/utils'
import type {
  Account,
  Category,
  LedgerTransaction,
  Liability,
  LiabilityDraft,
  Project,
  ProjectDraft,
  RepaymentDraft,
  SavingsDraft,
  SavingsEntryDraft,
  SavingsGoalDraft,
  SavingsGoalPlanDraft,
  SavingsGoalUpdateDraft,
  SavingsHolding,
} from '../types'

interface AssetsDebtsProps {
  liabilities: Liability[]
  savings: SavingsHolding[]
  accounts: Account[]
  categories: Category[]
  projects: Project[]
  transactions: LedgerTransaction[]
  /** Liquid balance after ledger-funded savings transfers. */
  liquidBalanceCents: number
  goalPlanContext: GoalPlanContext
  savingsRemindersEnabled: boolean
  onCreateLiability: (draft: LiabilityDraft) => void
  onUpdateLiability: (id: string, draft: LiabilityDraft) => void
  onDeleteLiability: (id: string) => void
  onAddRepayment: (liabilityId: string, draft: RepaymentDraft) => void
  onDeleteRepayment: (liabilityId: string, repaymentId: string) => void
  onCreateSavings: (draft: SavingsDraft) => void
  onUpdateSavings: (id: string, draft: SavingsDraft) => void
  onDeleteSavings: (id: string) => void
  onAddSavingsEntry: (holdingId: string, draft: SavingsEntryDraft) => void
  onDeleteSavingsEntry: (holdingId: string, entryId: string) => void
  onRenewSavings: (holdingId: string) => void
  onCreateGoal: (draft: SavingsGoalDraft) => void
  onUpdateGoal: (id: string, draft: SavingsGoalUpdateDraft) => void
  onApplyGoalPlan: (id: string, plan: SavingsGoalPlanDraft) => void
  onStartGoal: (id: string) => void
  onSettleGoal: (
    id: string,
    options: {
      spentCents: number
      writeToFlow: boolean
      categoryId: string
      accountId: string
    },
  ) => void
  onCancelGoal: (id: string) => void
  onCreateProject: (draft: ProjectDraft) => string
  onOpenSavingsReminderSettings: () => void
}

type Tab = 'savings' | 'liabilities'

export function AssetsDebts({
  liabilities,
  savings,
  accounts,
  categories,
  projects,
  transactions,
  liquidBalanceCents,
  goalPlanContext,
  savingsRemindersEnabled,
  onCreateLiability,
  onUpdateLiability,
  onDeleteLiability,
  onAddRepayment,
  onDeleteRepayment,
  onCreateSavings,
  onUpdateSavings,
  onDeleteSavings,
  onAddSavingsEntry,
  onDeleteSavingsEntry,
  onRenewSavings,
  onCreateGoal,
  onUpdateGoal,
  onApplyGoalPlan,
  onStartGoal,
  onSettleGoal,
  onCancelGoal,
  onCreateProject,
  onOpenSavingsReminderSettings,
}: AssetsDebtsProps) {
  // 资债页先展示储蓄，负债放在第二个 Tab。
  const [tab, setTab] = useState<Tab>('savings')
  const savingsTotals = getSavingsTotals(savings, undefined, transactions)
  const liabilityTotals = getLiabilityTotals(liabilities)
  const totalAssetsCents =
    liquidBalanceCents + savingsTotals.balanceCents
  const netWorthCents = totalAssetsCents - liabilityTotals.remainingCents
  const activeLiabilities = liabilities.filter(
    (item) => !getLiabilitySummary(item).settled,
  ).length

  return (
    <div className="page-stack assets-debts-page">
      <section className="card assets-debts-summary" aria-label="资产与负债">
        <div className="summary-cell">
          <span>总资产</span>
          <strong className={totalAssetsCents < 0 ? 'is-negative' : ''}>
            {formatSignedMoney(totalAssetsCents / 100)}
          </strong>
        </div>
        <div className="summary-cell">
          <span>储蓄</span>
          <strong className="is-income">
            {formatMoney(savingsTotals.balanceCents / 100)}
          </strong>
        </div>
        <div className="summary-cell">
          <span>负债</span>
          <strong
            className={
              liabilityTotals.remainingCents > 0 ? 'is-negative' : ''
            }
          >
            {formatMoney(liabilityTotals.remainingCents / 100)}
          </strong>
        </div>
        <div className="summary-cell">
          <span>净资产</span>
          <strong className={netWorthCents < 0 ? 'is-negative' : ''}>
            {formatSignedMoney(netWorthCents / 100)}
          </strong>
        </div>
        <div className="balance-equation" aria-label="净资产计算">
          <span>
            流动资金 <b>{formatSignedMoney(liquidBalanceCents / 100)}</b>
          </span>
          <i>+</i>
          <span>
            储蓄 <b>{formatMoney(savingsTotals.balanceCents / 100)}</b>
          </span>
          <i>−</i>
          <span>
            负债 <b>{formatMoney(liabilityTotals.remainingCents / 100)}</b>
          </span>
          <i>=</i>
          <strong>
            净资产 {formatSignedMoney(netWorthCents / 100)}
          </strong>
        </div>
      </section>

      <div className="assets-debts-tabs" role="tablist" aria-label="资债分类">
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'savings'}
          className={tab === 'savings' ? 'is-active' : ''}
          onClick={() => setTab('savings')}
        >
          <PiggyBank size={16} />
          储蓄
          <span>{savingsTotals.activeCount}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'liabilities'}
          className={tab === 'liabilities' ? 'is-active' : ''}
          onClick={() => setTab('liabilities')}
        >
          <Scale size={16} />
          负债
          <span>{activeLiabilities}</span>
        </button>
        <div className="assets-debts-tab-note">
          <Wallet size={14} />
          流动资金 {formatSignedMoney(liquidBalanceCents / 100)} · 储蓄与负债不计入日常收支统计
        </div>
      </div>

      {tab === 'savings' ? (
        <Savings
          holdings={savings}
          accounts={accounts}
          projects={projects}
          transactions={transactions}
          categories={categories}
          goalPlanContext={goalPlanContext}
          remindersEnabled={savingsRemindersEnabled}
          onCreate={onCreateSavings}
          onUpdate={onUpdateSavings}
          onDelete={onDeleteSavings}
          onAddEntry={onAddSavingsEntry}
          onDeleteEntry={onDeleteSavingsEntry}
          onRenew={onRenewSavings}
          onCreateGoal={onCreateGoal}
          onUpdateGoal={onUpdateGoal}
          onApplyGoalPlan={onApplyGoalPlan}
          onStartGoal={onStartGoal}
          onSettleGoal={onSettleGoal}
          onCancelGoal={onCancelGoal}
          onCreateProject={onCreateProject}
          onOpenReminderSettings={onOpenSavingsReminderSettings}
        />
      ) : (
        <Liabilities
          liabilities={liabilities}
          onCreate={onCreateLiability}
          onUpdate={onUpdateLiability}
          onDelete={onDeleteLiability}
          onAddRepayment={onAddRepayment}
          onDeleteRepayment={onDeleteRepayment}
        />
      )}
    </div>
  )
}
