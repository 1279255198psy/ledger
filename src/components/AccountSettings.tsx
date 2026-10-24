import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  Check,
  CreditCard,
  Pencil,
  Plus,
  Trash2,
  Wallet,
  X,
} from 'lucide-react'
import { SelectMenu } from './SelectMenu'
import {
  ACCOUNT_TYPE_LABELS,
  BANK_PRESETS,
  uniqueAccountName,
} from '../lib/accounts'
import type { Account } from '../types'

interface AccountSettingsProps {
  accounts: Account[]
  /** How many transactions point at each account id. */
  transactionUsage: Record<string, number>
  onCreate: (bank: string, name: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
}

const CUSTOM_BANK = '__custom__'
/** Names plus the automatic「 2」suffix must stay inside the stored 24 chars. */
const NAME_LIMIT = 20

export function AccountSettings({
  accounts,
  transactionUsage,
  onCreate,
  onRename,
  onDelete,
}: AccountSettingsProps) {
  const [bankChoice, setBankChoice] = useState('')
  const [customBank, setCustomBank] = useState('')
  const [cardName, setCardName] = useState('')
  const [formError, setFormError] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editError, setEditError] = useState('')

  const wallets = accounts.filter((account) => account.type !== 'bank')
  const cards = accounts.filter((account) => account.type === 'bank')

  const bank =
    bankChoice === CUSTOM_BANK ? customBank.trim() : bankChoice.trim()
  const defaultCardName = cardName.trim() || bank
  const previewName = defaultCardName
    ? uniqueAccountName(defaultCardName, accounts)
    : ''
  const willNumber = previewName !== '' && previewName !== defaultCardName

  const bankOptions = [
    ...BANK_PRESETS.map((name) => ({
      value: name,
      label: name,
      group: '常用银行',
    })),
    { value: CUSTOM_BANK, label: '其他银行（自定义）', group: '自定义' },
  ]

  const startEditing = (account: Account) => {
    setEditingId(account.id)
    setEditName(account.name)
    setEditError('')
  }

  const closeEditing = () => {
    setEditingId(null)
    setEditName('')
    setEditError('')
  }

  const handleCreate = (event: FormEvent) => {
    event.preventDefault()
    if (!bank) {
      setFormError('先选择一家银行，或者填写自定义银行名称')
      return
    }
    if (bank.length > NAME_LIMIT) {
      setFormError(`银行名称最多 ${NAME_LIMIT} 个字`)
      return
    }
    if (defaultCardName.length > NAME_LIMIT) {
      setFormError(`卡名最多 ${NAME_LIMIT} 个字`)
      return
    }
    setFormError('')
    onCreate(bank, cardName.trim())
    setBankChoice('')
    setCustomBank('')
    setCardName('')
  }

  const handleRename = (event: FormEvent, account: Account) => {
    event.preventDefault()
    const trimmed = editName.trim()
    if (!trimmed) {
      setEditError('卡名不能为空')
      return
    }
    if (trimmed.length > NAME_LIMIT) {
      setEditError(`卡名最多 ${NAME_LIMIT} 个字`)
      return
    }
    setEditError('')
    onRename(account.id, trimmed)
    closeEditing()
  }

  return (
    <div className="account-admin">
      <div className="account-group">
        <div className="account-group-head">
          <strong>常用钱包</strong>
          <small>微信、支付宝与现金是固定账户，每一笔都可以继续使用</small>
        </div>
        <div className="account-list">
          {wallets.map((account) => {
            const used = transactionUsage[account.id] ?? 0
            return (
              <div className="account-row" key={account.id}>
                <span className="account-row-icon" aria-hidden="true">
                  <Wallet size={17} />
                </span>
                <div className="account-row-copy">
                  <strong>{account.name}</strong>
                  <small>
                    {ACCOUNT_TYPE_LABELS[account.type]} ·{' '}
                    {used > 0 ? `${used} 笔流水` : '还没有流水'}
                  </small>
                </div>
                <span className="account-badge">内置</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="account-group">
        <div className="account-group-head">
          <strong>银行卡</strong>
          <small>
            可以添加多张卡。卡名重复时会自动加上编号，也可以随时改名。
          </small>
        </div>
        <div className="account-list">
          {cards.length === 0 ? (
            <p className="account-empty">还没有银行卡，在下面添加第一张。</p>
          ) : (
            cards.map((account) => {
              const used = transactionUsage[account.id] ?? 0
              const editing = editingId === account.id
              const renamePreview = uniqueAccountName(
                editName.trim(),
                accounts,
                account.id,
              )
              return (
                <div className="account-row account-row--card" key={account.id}>
                  <span className="account-row-icon" aria-hidden="true">
                    <CreditCard size={17} />
                  </span>
                  {editing ? (
                    <form
                      className="account-rename"
                      onSubmit={(event) => handleRename(event, account)}
                    >
                      <input
                        value={editName}
                        onChange={(event) => {
                          setEditName(event.target.value)
                          setEditError('')
                        }}
                        maxLength={NAME_LIMIT}
                        placeholder="卡名"
                        aria-label={`修改${account.name}的卡名`}
                        autoFocus
                      />
                      <button
                        type="submit"
                        className="category-admin-action"
                        aria-label="保存卡名"
                        title="保存"
                      >
                        <Check size={15} />
                      </button>
                      <button
                        type="button"
                        className="category-admin-action"
                        onClick={closeEditing}
                        aria-label="取消修改"
                        title="取消"
                      >
                        <X size={15} />
                      </button>
                      {editError ? (
                        <p className="account-rename-hint is-error">
                          {editError}
                        </p>
                      ) : renamePreview !== editName.trim() &&
                        editName.trim() ? (
                        <p className="account-rename-hint">
                          已存在同名卡，将保存为「{renamePreview}」
                        </p>
                      ) : null}
                    </form>
                  ) : (
                    <>
                      <div className="account-row-copy">
                        <strong>{account.name}</strong>
                        <small>
                          {account.bank ? `${account.bank} · ` : ''}
                          {used > 0 ? `${used} 笔流水` : '还没有流水'}
                        </small>
                      </div>
                      <button
                        type="button"
                        className="category-admin-action"
                        onClick={() => startEditing(account)}
                        aria-label={`重命名${account.name}`}
                        title="重命名"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        className="category-admin-action category-admin-action--danger"
                        onClick={() => onDelete(account.id)}
                        disabled={used > 0}
                        aria-label={`删除${account.name}`}
                        title={
                          used > 0
                            ? `这张卡还有 ${used} 笔流水，暂时不能删除`
                            : '删除这张卡'
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </>
                  )}
                </div>
              )
            })
          )}
        </div>

        <form className="account-create" onSubmit={handleCreate}>
          <div className="account-create-head">
            <strong>添加银行卡</strong>
            <small>从常用银行里挑一家，或者填自己习惯的银行名称</small>
          </div>
          <div className="account-create-fields">
            <div className="field">
              <span className="field-label">银行</span>
              <SelectMenu
                value={bankChoice}
                options={bankOptions}
                onChange={(value) => {
                  setBankChoice(value)
                  setFormError('')
                }}
                ariaLabel="选择银行"
                placeholder="选择银行"
                icon={<CreditCard size={15} aria-hidden />}
                className="account-bank-select"
                elevated
              />
            </div>
            <label className="field">
              <span className="field-label">
                卡名 <span className="optional">选填</span>
              </span>
              <input
                value={cardName}
                onChange={(event) => {
                  setCardName(event.target.value)
                  setFormError('')
                }}
                maxLength={NAME_LIMIT}
                placeholder={bank || '例如：招行工资卡'}
                aria-label="银行卡名称"
              />
            </label>
          </div>

          {bankChoice === CUSTOM_BANK ? (
            <label className="field">
              <span className="field-label">自定义银行</span>
              <input
                value={customBank}
                onChange={(event) => {
                  setCustomBank(event.target.value)
                  setFormError('')
                }}
                maxLength={NAME_LIMIT}
                placeholder="例如：老家信用社"
                aria-label="自定义银行名称"
              />
            </label>
          ) : null}

          {previewName ? (
            <p className="account-create-preview">
              将保存为「{previewName}」
              {willNumber ? '（已有同名卡，已自动加编号）' : ''}
            </p>
          ) : null}

          {formError ? (
            <p className="form-error" role="alert">
              {formError}
            </p>
          ) : null}

          <button type="submit" className="button primary account-create-submit">
            <Plus size={15} />
            添加银行卡
          </button>
        </form>
      </div>
    </div>
  )
}
