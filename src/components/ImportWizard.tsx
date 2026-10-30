import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  FileSpreadsheet,
  Loader2,
  Save,
  Trash2,
  Undo2,
  Upload,
  X,
} from 'lucide-react'
import { Modal } from './Modal'
import {
  ADAPTERS,
  detectAdapters,
  getAdapter,
  mappingFields,
} from '../lib/exchange/adapters'
import {
  buildTable,
  detectHeaders,
} from '../lib/exchange/columns'
import {
  cleanRows,
  decodeBytes,
  decodeBytesAs,
  parseCsv,
  type Encoding,
} from '../lib/exchange/csv'
import {
  accountTypeForName,
  buildImportPlan,
  suggestAccountChoices,
  suggestCategoryChoices,
} from '../lib/exchange/plan'
import {
  applyAccountTargets,
  applyCategoryTargets,
  buildTemplate,
  loadTemplates,
  mappingForHeaders,
  removeTemplate,
  saveTemplates,
  upsertTemplate,
} from '../lib/exchange/templates'
import { confirmDesktopAction } from '../lib/desktop'
import type {
  AccountChoice,
  AccountTarget,
  CategoryChoice,
  CategoryTarget,
  ColumnMapping,
  ExchangeRow,
  ImportPlan,
  ImportTemplate,
} from '../lib/exchange/types'
import type {
  Account,
  Category,
  LedgerTransaction,
  TransactionType,
} from '../types'
import { formatMoney } from '../lib/utils'

interface ImportWizardProps {
  categories: Category[]
  accounts: Account[]
  transactions: LedgerTransaction[]
  onClose: () => void
  onCommit: (plan: ImportPlan) => Promise<void>
  /** Resolves false when the user cancelled the confirmation. */
  onUndo: (batchId: string) => Promise<boolean>
}

type Step = 'file' | 'preview' | 'mapping' | 'done'

type EncodingChoice = 'auto' | Encoding

const ENCODING_LABELS: Record<EncodingChoice, string> = {
  auto: '自动识别',
  'utf-8': 'UTF-8',
  'gb18030': 'GBK / GB18030',
  'utf-16le': 'UTF-16 LE',
  'utf-16be': 'UTF-16 BE',
}

const DIRECTION_LABELS: Record<ExchangeRow['direction'], string> = {
  expense: '支出',
  income: '收入',
  refund: '退款',
  transfer: '转账',
  unknown: '未识别',
}

const TYPE_LABELS: Record<TransactionType, string> = {
  expense: '支出',
  income: '收入',
}

function newBatchId(): string {
  return `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function categoryLabel(category: Category, categories: Category[]): string {
  if (!category.parentId) return category.name
  const parent = categories.find((item) => item.id === category.parentId)
  return parent ? `${parent.name} · ${category.name}` : category.name
}

function categoryOptions(
  categories: Category[],
  type: TransactionType,
): Array<{ id: string; label: string }> {
  return categories
    .filter((category) => category.type === type)
    .map((category) => ({
      id: category.id,
      label: categoryLabel(category, categories),
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh'))
}

function categoryTargetValue(target: CategoryTarget): string {
  if (target.kind === 'existing') return `id:${target.id}`
  if (target.kind === 'create') return `create:${target.name}`
  return 'skip'
}

function categoryTargetFrom(
  value: string,
  fallbackName: string,
): CategoryTarget {
  if (value === 'skip') return { kind: 'skip' }
  if (value.startsWith('id:')) return { kind: 'existing', id: value.slice(3) }
  const name = value.startsWith('create:') ? value.slice(7) : fallbackName
  return { kind: 'create', name: name || '其他' }
}

function accountTargetValue(target: AccountTarget): string {
  if (target.kind === 'existing') return `id:${target.id}`
  if (target.kind === 'create') return `create:${target.name}`
  return 'skip'
}

function accountTargetFrom(value: string, choice: AccountChoice): AccountTarget {
  if (value === 'skip') return { kind: 'skip' }
  if (value.startsWith('id:')) return { kind: 'existing', id: value.slice(3) }
  const name = value.startsWith('create:')
    ? value.slice(7)
    : choice.sourceName || '现金'
  return {
    kind: 'create',
    name: name || '现金',
    type: accountTypeForName(name) ?? 'cash',
  }
}

function sizeLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** .xlsx is a ZIP archive and .xls an OLE compound file; neither is CSV. */
function isSpreadsheetBinary(bytes: Uint8Array): boolean {
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b
  const ole = bytes[0] === 0xd0 && bytes[1] === 0xcf
  return zip || ole
}

function Stat(props: { label: string; value: string; tone?: 'expense' | 'income' }) {
  return (
    <div className={`import-stat${props.tone ? ` is-${props.tone}` : ''}`}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
}

/**
 * File → preview → mapping → commit. Every external format is reduced to the
 * same `ExchangeRow` before this screen sees it, so the wizard never needs to
 * know which app produced the file.
 */
export function ImportWizard({
  categories,
  accounts,
  transactions,
  onClose,
  onCommit,
  onUndo,
}: ImportWizardProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [step, setStep] = useState<Step>('file')
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [bytes, setBytes] = useState<Uint8Array | null>(null)
  const [text, setText] = useState('')
  const [encodingChoice, setEncodingChoice] = useState<EncodingChoice>('auto')
  const [decodedEncoding, setDecodedEncoding] = useState<Encoding>('utf-8')
  const [table, setTable] = useState<ReturnType<typeof buildTable>>(null)
  const [adapterId, setAdapterId] = useState('csv')
  const [mappingOverride, setMappingOverride] = useState<ColumnMapping>({})
  const [categoryChoices, setCategoryChoices] = useState<CategoryChoice[]>([])
  const [accountChoices, setAccountChoices] = useState<AccountChoice[]>([])
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [batchId, setBatchId] = useState(newBatchId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [committed, setCommitted] = useState<ImportPlan | null>(null)
  const [templates, setTemplates] = useState<ImportTemplate[]>(loadTemplates)
  const [templateId, setTemplateId] = useState('')
  const [pendingTemplate, setPendingTemplate] = useState<ImportTemplate | null>(
    null,
  )
  const [templateName, setTemplateName] = useState('')
  const [templateNotice, setTemplateNotice] = useState('')
  /** Columns in effect before a template was applied, restored on "不使用". */
  const [templateBackup, setTemplateBackup] = useState<{
    adapterId: string
    mappingOverride: ColumnMapping
  } | null>(null)

  const adapter = useMemo(() => getAdapter(adapterId), [adapterId])
  const selectedTemplate =
    templates.find((template) => template.id === templateId) ?? null

  const parseResult = useMemo(() => {
    if (!table) return null
    return adapter.parse(table, text, mappingOverride)
  }, [table, text, adapter, mappingOverride])

  const detectedChoices = useMemo(
    () => (table ? detectAdapters(table, text) : []),
    [table, text],
  )

  const rows = parseResult?.rows ?? []

  const totals = useMemo(() => {
    let expense = 0
    let income = 0
    const dates: string[] = []
    for (const row of rows) {
      if (row.date) dates.push(row.date)
      if (row.direction === 'expense') expense += row.amountCents
      if (row.direction === 'refund') expense -= row.amountCents
      if (row.direction === 'income') income += row.amountCents
    }
    dates.sort()
    return {
      expenseCents: expense,
      incomeCents: income,
      firstDate: dates[0] ?? '',
      lastDate: dates[dates.length - 1] ?? '',
    }
  }, [rows])

  const plan = useMemo(() => {
    if (step !== 'mapping' || !parseResult) return null
    return buildImportPlan(
      parseResult.rows,
      categoryChoices,
      accountChoices,
      { skipDuplicates, skipTransfers: true },
      {
        categories,
        accounts,
        existing: transactions,
        sourceId: adapter.id,
        batchId,
      },
    )
  }, [
    step,
    parseResult,
    categoryChoices,
    accountChoices,
    skipDuplicates,
    categories,
    accounts,
    transactions,
    adapter.id,
    batchId,
  ])

  const applyText = (nextText: string, nextEncoding: Encoding) => {
    setText(nextText)
    setDecodedEncoding(nextEncoding)
    setTemplateId('')
    setPendingTemplate(null)
    setTemplateName('')
    setTemplateNotice('')
    setTemplateBackup(null)
    const nextTable = buildTable(cleanRows(parseCsv(nextText)))
    if (!nextTable) {
      setTable(null)
      setError('没有在这个文件里找到表头。请确认导出的是 CSV，并且第一行包含日期、金额等列名。')
      return
    }
    const matches = detectAdapters(nextTable, nextText)
    setTable(nextTable)
    setAdapterId(matches[0]?.adapter.id ?? 'csv')
    setMappingOverride({})
    setCategoryChoices([])
    setAccountChoices([])
    setError('')
    setStep('preview')
  }

  const decodeAndApply = (nextBytes: Uint8Array, choice: EncodingChoice) => {
    const decoded =
      choice === 'auto'
        ? decodeBytes(nextBytes)
        : { text: decodeBytesAs(nextBytes, choice), encoding: choice }
    applyText(decoded.text, decoded.encoding)
  }

  const handleFile = async (file: File) => {
    try {
      setError('')
      const buffer = await file.arrayBuffer()
      const nextBytes = new Uint8Array(buffer)
      setFileName(file.name)
      setFileSize(file.size)
      if (isSpreadsheetBinary(nextBytes)) {
        setBytes(null)
        setError(
          '这是 Excel 文件（.xlsx / .xls），账页只读 CSV。请在记账软件里选择“导出 CSV”，或先用 Excel 另存为 CSV 再导入。',
        )
        return
      }
      setBytes(nextBytes)
      setBatchId(newBatchId())
      decodeAndApply(nextBytes, encodingChoice)
    } catch {
      setError('读取文件失败，请重新选择。')
    }
  }

  const handleEncodingChange = (choice: EncodingChoice) => {
    setEncodingChoice(choice)
    if (bytes) decodeAndApply(bytes, choice)
  }

  const handleAdapterChange = (id: string) => {
    setAdapterId(id)
    setMappingOverride({})
    setTemplateId('')
    setPendingTemplate(null)
    setTemplateName('')
    setTemplateNotice('')
    setTemplateBackup(null)
  }

  const handleTemplateChange = (id: string) => {
    setTemplateId(id)
    setTemplateNotice('')
    if (!id) {
      setPendingTemplate(null)
      setTemplateName('')
      if (templateBackup) {
        setAdapterId(templateBackup.adapterId)
        setMappingOverride(templateBackup.mappingOverride)
        setTemplateBackup(null)
      }
      return
    }
    const template = templates.find((item) => item.id === id)
    if (!template || !table) return

    if (!templateBackup) {
      setTemplateBackup({ adapterId, mappingOverride })
    }
    setPendingTemplate(template)
    setTemplateName(template.name)
    // The saved template decides the format as well as the columns.
    setAdapterId(getAdapter(template.sourceId).id)
    setMappingOverride(mappingForHeaders(template.mapping, table.headers))
    setTemplateNotice(
      `已套用模板「${template.name}」，下一步会同时套用分类和账户对应。`,
    )
  }

  const handleDeleteTemplate = async () => {
    if (!selectedTemplate) return
    const confirmed = await confirmDesktopAction(
      `删除导入模板「${selectedTemplate.name}」吗？已经导入的数据不受影响。`,
      '删除模板',
    )
    if (!confirmed) return
    const next = removeTemplate(templates, selectedTemplate.id)
    saveTemplates(next)
    setTemplates(next)
    setTemplateId('')
    setPendingTemplate(null)
    setTemplateName('')
    setTemplateNotice('')
    setTemplateBackup(null)
  }

  const handleSaveTemplate = () => {
    if (!parseResult) return
    const name = templateName.trim() || `${adapter.label}模板`
    const existing = templates.find((item) => item.name === name)
    const template = buildTemplate({
      name,
      sourceId: adapter.id,
      // The adapter's detected mapping plus anything the user changed.
      mapping: { ...parseResult.mapping, ...mappingOverride },
      categoryChoices,
      accountChoices,
      id: existing?.id,
      createdAt: existing?.createdAt,
    })
    const { templates: next, saved } = upsertTemplate(templates, template)
    saveTemplates(next)
    setTemplates(next)
    setTemplateId(saved.id)
    setPendingTemplate(saved)
    setTemplateName(saved.name)
    setTemplateNotice(`已保存模板「${saved.name}」`)
  }

  const handleFieldMapping = (field: keyof ColumnMapping, header: string) => {
    // Keep an empty string rather than deleting: an explicit "不使用" must
    // override the detected column instead of falling back to it.
    setMappingOverride((current) => ({ ...current, [field]: header }))
  }

  const goToMapping = () => {
    if (!parseResult || parseResult.rows.length === 0) {
      setError('这个文件里没有可导入的流水，请检查字段映射是否正确。')
      return
    }
    const baseCategories = suggestCategoryChoices(parseResult.rows, categories)
    const baseAccounts = suggestAccountChoices(
      parseResult.rows,
      accounts,
      adapter.accountType,
    )
    setCategoryChoices(
      pendingTemplate
        ? applyCategoryTargets(
            baseCategories,
            pendingTemplate.categories,
            categories,
          )
        : baseCategories,
    )
    setAccountChoices(
      pendingTemplate
        ? applyAccountTargets(
            baseAccounts,
            pendingTemplate.accounts,
            accounts,
          )
        : baseAccounts,
    )
    setError('')
    setStep('mapping')
  }

  const updateCategoryChoice = (key: string, value: string) => {
    setCategoryChoices((current) =>
      current.map((choice) =>
        choice.key === key
          ? {
              ...choice,
              target: categoryTargetFrom(
                value,
                choice.sourceName || (choice.type === 'income' ? '其他收入' : '其他'),
              ),
            }
          : choice,
      ),
    )
  }

  const updateAccountChoice = (key: string, value: string) => {
    setAccountChoices((current) =>
      current.map((choice) =>
        choice.key === key
          ? { ...choice, target: accountTargetFrom(value, choice) }
          : choice,
      ),
    )
  }

  const handleImport = async () => {
    if (!plan || plan.transactions.length === 0 || busy) return
    setBusy(true)
    setError('')
    try {
      await onCommit(plan)
      setCommitted(plan)
      setStep('done')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '导入失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const handleUndo = async () => {
    if (!committed || busy) return
    setBusy(true)
    setError('')
    try {
      const undone = await onUndo(committed.batchId)
      if (undone) onClose()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '撤销失败，请稍后重试。')
    } finally {
      setBusy(false)
    }
  }

  const stepIndex = step === 'file' ? 0 : step === 'preview' ? 1 : step === 'mapping' ? 2 : 3

  return (
    <Modal open onClose={onClose} labelledBy="import-wizard-title" className="import-modal">
      <header className="modal-header import-header">
        <div>
          <span className="import-eyebrow">
            <FileSpreadsheet size={14} />
            数据迁移
          </span>
          <h2 id="import-wizard-title">导入其他软件的数据</h2>
          <p className="import-subtitle">
            微信、支付宝、随手记、钱迹、鲨鱼记账等导出的账单，都可以导入账页。
            文件只在本机读取，不会上传。
          </p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="关闭">
          <X size={18} />
        </button>
      </header>

      <ol className="import-steps" aria-label="导入步骤">
        {['选择文件', '核对数据', '对应分类与账户', '完成'].map((label, index) => (
          <li
            key={label}
            className={
              index === stepIndex
                ? 'is-current'
                : index < stepIndex
                  ? 'is-done'
                  : ''
            }
          >
            <span>{index < stepIndex ? <Check size={12} /> : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      <div className="modal-body import-body">
        {error ? (
          <p className="form-error import-error">
            <AlertTriangle size={15} />
            {error}
          </p>
        ) : null}

        {step === 'file' ? (
          <div className="import-file-step">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              className="sr-only"
              tabIndex={-1}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void handleFile(file)
                event.currentTarget.value = ''
              }}
            />
            <button
              type="button"
              className="import-drop"
              onClick={() => fileInputRef.current?.click()}
            >
              <span className="import-drop-icon">
                <Upload size={22} />
              </span>
              <strong>{fileName || '选择账单文件'}</strong>
              <small>
                {fileName
                  ? `${sizeLabel(fileSize)} · 已按 ${ENCODING_LABELS[decodedEncoding]} 读取`
                  : '支持 .csv / .txt，可直接选择微信、支付宝等软件导出的账单'}
              </small>
            </button>

            <div className="import-encoding">
              <label htmlFor="import-encoding">文件编码</label>
              <select
                id="import-encoding"
                value={encodingChoice}
                onChange={(event) =>
                  handleEncodingChange(event.target.value as EncodingChoice)
                }
              >
                {(Object.keys(ENCODING_LABELS) as EncodingChoice[]).map((value) => (
                  <option key={value} value={value}>
                    {ENCODING_LABELS[value]}
                  </option>
                ))}
              </select>
              <small>中文乱码时换一个编码再试；支付宝旧版账单通常是 GBK。</small>
            </div>

            <div className="import-formats">
              <p>已经内置的格式</p>
              <div className="import-chips">
                {ADAPTERS.filter((item) => item.id !== 'csv').map((item) => (
                  <span key={item.id}>{item.label}</span>
                ))}
                <span>通用 CSV</span>
              </div>
            </div>

            {templates.length > 0 ? (
              <p className="import-template-tip">
                已保存 {templates.length} 个导入模板，选择文件后可在「核对数据」页套用。
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 'preview' && table ? (
          <div className="import-preview-step">
            <div className="import-format-row">
              <div className="field import-format-field">
                <label className="field-label" htmlFor="import-format">
                  来源格式
                </label>
                <select
                  id="import-format"
                  value={adapterId}
                  onChange={(event) => handleAdapterChange(event.target.value)}
                >
                  {ADAPTERS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                      {detectedChoices[0]?.adapter.id === item.id
                        ? '（自动识别）'
                        : ''}
                    </option>
                  ))}
                </select>
              </div>
              <p className="import-format-hint">{adapter.description}</p>
            </div>

            <div className="import-template-row">
              <div className="field import-template-field">
                <label className="field-label" htmlFor="import-template">
                  导入模板
                </label>
                <select
                  id="import-template"
                  value={templateId}
                  onChange={(event) => handleTemplateChange(event.target.value)}
                >
                  <option value="">不使用模板</option>
                  {templates.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {getAdapter(item.sourceId).label}
                    </option>
                  ))}
                </select>
              </div>
              {selectedTemplate ? (
                <button
                  type="button"
                  className="button ghost import-template-delete"
                  onClick={() => void handleDeleteTemplate()}
                >
                  <Trash2 size={14} />
                  删除
                </button>
              ) : null}
              <p className="import-template-hint">
                {templateNotice ||
                  (templates.length > 0
                    ? '套用后会同时使用模板里的字段、分类和账户对应。'
                    : '可在下一步调整好对应关系后保存为模板。')}
              </p>
            </div>

            <div className="import-stats">
              <Stat label="识别到" value={`${rows.length} 笔`} />
              <Stat
                label="支出合计"
                value={formatMoney(Math.max(0, totals.expenseCents) / 100)}
                tone="expense"
              />
              <Stat label="收入合计" value={formatMoney(totals.incomeCents / 100)} tone="income" />
              <Stat
                label="日期范围"
                value={
                  totals.firstDate
                    ? `${totals.firstDate} 至 ${totals.lastDate}`
                    : '—'
                }
              />
            </div>

            {parseResult && parseResult.warnings.length > 0 ? (
              <ul className="import-warnings">
                {parseResult.warnings.map((warning) => (
                  <li key={warning}>
                    <AlertTriangle size={13} />
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}

            <details className="import-columns" open={!detectHeaders(table).headerUseful}>
              <summary>
                字段映射
                <span>
                  {detectHeaders(table).headerUseful
                    ? '已自动对应，可点开修改'
                    : '请手动指定日期和金额列'}
                </span>
              </summary>
              <div className="import-column-grid">
                {mappingFields().map((field) => (
                  <label key={field.key} className="import-column-field">
                    <span>
                      {field.label}
                      {field.required ? <em>必填</em> : null}
                    </span>
                    <select
                      value={
                        mappingOverride[field.key] ??
                        parseResult?.mapping[field.key] ??
                        ''
                      }
                      onChange={(event) =>
                        handleFieldMapping(field.key, event.target.value)
                      }
                    >
                      <option value="">不使用</option>
                      {table.headers.map((header, index) => (
                        <option key={`${header}-${index}`} value={header}>
                          {header}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </details>

            <div className="import-table-wrap">
              <table className="import-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>类型</th>
                    <th>分类</th>
                    <th>账户</th>
                    <th className="is-number">金额</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((row, index) => (
                    <tr key={`${row.rowNumber}-${index}`}>
                      <td>{row.date || '—'}</td>
                      <td>{DIRECTION_LABELS[row.direction]}</td>
                      <td>{row.categoryName || '默认'}</td>
                      <td>{row.accountName || '—'}</td>
                      <td className="is-number">{formatMoney(row.amountCents / 100)}</td>
                      <td className="import-note-cell" title={row.note}>
                        {row.note || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 8 ? (
                <p className="import-table-more">还有 {rows.length - 8} 笔未在预览中显示</p>
              ) : null}
            </div>

            {parseResult && parseResult.skipped.length > 0 ? (
              <p className="import-skipped-note">
                已跳过 {parseResult.skipped.length} 行无法识别的数据
                {parseResult.skipped[0]
                  ? `，例如第 ${parseResult.skipped[0].rowNumber} 行：${parseResult.skipped[0].reason}`
                  : ''}
                。
              </p>
            ) : null}
          </div>
        ) : null}

        {step === 'mapping' ? (
          <div className="import-mapping-step">
            <p className="import-lead">
              把来源里的名字对应到账页。没有对应项的会自动新建，也可以选择“不导入”。
            </p>

            {(['expense', 'income'] as TransactionType[]).map((type) => {
              const list = categoryChoices.filter((choice) => choice.type === type)
              if (list.length === 0) return null
              const options = categoryOptions(categories, type)
              return (
                <section key={type} className="import-map-section">
                  <h3>{TYPE_LABELS[type]}分类</h3>
                  <ul className="import-map-list">
                    {list.map((choice) => {
                      const name = choice.sourceName || '未提供分类'
                      const target = choice.target
                      const createName =
                        target.kind === 'create'
                          ? target.name
                          : choice.sourceName ||
                            (type === 'income' ? '其他收入' : '其他')
                      const parentId =
                        target.kind === 'create' ? target.parentId : undefined
                      const parentName = parentId
                        ? categories.find((category) => category.id === parentId)?.name
                        : ''
                      const createLabel = parentName
                        ? `${parentName} · ${createName}`
                        : createName
                      return (
                        <li key={choice.key} className="import-map-row">
                          <div className="import-map-source">
                            <strong>{name}</strong>
                            <small>{choice.count} 笔</small>
                          </div>
                          <select
                            className="import-select"
                            value={categoryTargetValue(choice.target)}
                            onChange={(event) =>
                              updateCategoryChoice(choice.key, event.target.value)
                            }
                            aria-label={`${name} 对应到`}
                          >
                            {options.map((option) => (
                              <option key={option.id} value={`id:${option.id}`}>
                                {option.label}
                              </option>
                            ))}
                            <option value={`create:${createName}`}>
                              新建分类「{createLabel}」
                            </option>
                            <option value="skip">不导入这类</option>
                          </select>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}

            <section className="import-map-section">
              <h3>账户</h3>
              <ul className="import-map-list">
                {accountChoices.map((choice) => {
                  const name = choice.sourceName || '默认账户'
                  const createName =
                    choice.target.kind === 'create'
                      ? choice.target.name
                      : choice.sourceName || '现金'
                  return (
                    <li key={choice.key} className="import-map-row">
                      <div className="import-map-source">
                        <strong>{name}</strong>
                        <small>{choice.count} 笔</small>
                      </div>
                      <select
                        className="import-select"
                        value={accountTargetValue(choice.target)}
                        onChange={(event) =>
                          updateAccountChoice(choice.key, event.target.value)
                        }
                        aria-label={`${name} 对应到`}
                      >
                        {accounts.map((account) => (
                          <option key={account.id} value={`id:${account.id}`}>
                            {account.name}
                          </option>
                        ))}
                        <option value={`create:${createName}`}>
                          新建账户「{createName}」
                        </option>
                        <option value="skip">不导入这类</option>
                      </select>
                    </li>
                  )
                })}
              </ul>
            </section>

            <div className="import-template-save">
              <div className="field import-template-name-field">
                <label className="field-label" htmlFor="import-template-name">
                  模板名称
                </label>
                <input
                  id="import-template-name"
                  value={templateName}
                  maxLength={40}
                  placeholder={`${adapter.label}模板`}
                  onChange={(event) => setTemplateName(event.target.value)}
                />
              </div>
              <button
                type="button"
                className="button secondary"
                onClick={handleSaveTemplate}
              >
                <Save size={15} />
                {templates.some(
                  (item) =>
                    item.name ===
                    (templateName.trim() || `${adapter.label}模板`),
                )
                  ? '更新模板'
                  : '保存模板'}
              </button>
              <p className="import-template-hint">
                {templateNotice ||
                  '保存后，下次导入同类文件可在上一步直接套用这套对应关系。'}
              </p>
            </div>

            <label className="import-check">
              <input
                type="checkbox"
                checked={skipDuplicates}
                onChange={(event) => setSkipDuplicates(event.target.checked)}
              />
              <span>
                <strong>跳过重复记录</strong>
                <small>
                  交易单号相同，或日期、金额、账户、备注都相同的流水，默认不再导入。
                </small>
              </span>
            </label>

            {plan ? (
              <div className="import-plan">
                <div className="import-plan-head">
                  <strong>将导入 {plan.transactions.length} 笔</strong>
                  <span>{adapter.label}</span>
                </div>
                <p>
                  {plan.skippedDuplicate > 0 ? `重复跳过 ${plan.skippedDuplicate} 笔 · ` : ''}
                  {plan.skippedTransfer > 0 ? `转账/不计收支跳过 ${plan.skippedTransfer} 笔 · ` : ''}
                  {plan.skippedInvalid > 0 ? `无法识别 ${plan.skippedInvalid} 笔 · ` : ''}
                  {plan.skippedByMapping > 0 ? `按映射跳过 ${plan.skippedByMapping} 笔 · ` : ''}
                  {plan.newCategories.length > 0
                    ? `新建 ${plan.newCategories.length} 个分类`
                    : '不新建分类'}
                  {plan.newAccounts.length > 0
                    ? `，新建 ${plan.newAccounts.length} 个账户`
                    : ''}
                </p>
                {plan.skippedTransfer > 0 ? (
                  <p className="import-plan-hint">
                    账页暂不支持转账类型，这部分会跳过；如果只是零钱提现或账户互转，
                    跳过不会影响收支统计。
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 'done' && committed ? (
          <div className="import-done">
            <span className="import-done-icon">
              <Check size={26} />
            </span>
            <h3>已导入 {committed.transactions.length} 笔流水</h3>
            <p>
              来源：{adapter.label}。原始文件没有改动，导入前也已经自动备份了一份账本。
            </p>
            {committed.skippedDuplicate + committed.skippedTransfer + committed.skippedInvalid + committed.skippedByMapping > 0 ? (
              <p className="import-done-skip">
                另外跳过 {committed.skippedDuplicate} 笔重复、
                {committed.skippedTransfer} 笔转账、
                {committed.skippedInvalid} 笔无法识别、
                {committed.skippedByMapping} 笔按映射排除。
              </p>
            ) : null}
            <button
              type="button"
              className="button secondary"
              onClick={() => void handleUndo()}
              disabled={busy}
            >
              <Undo2 size={15} />
              撤销这批导入
            </button>
          </div>
        ) : null}
      </div>

      <footer className="modal-footer import-footer">
        <div className="import-footer-left">
          {step === 'preview' || step === 'mapping' ? (
            <button
              type="button"
              className="button ghost"
              onClick={() =>
                step === 'mapping' ? setStep('preview') : setStep('file')
              }
              disabled={busy}
            >
              <ArrowLeft size={15} />
              上一步
            </button>
          ) : null}
        </div>
        <div className="modal-actions">
          {step === 'file' ? (
            <button type="button" className="button ghost" onClick={onClose}>
              取消
            </button>
          ) : null}
          {step === 'preview' ? (
            <button type="button" className="button primary" onClick={goToMapping}>
              下一步
              <ArrowRight size={15} />
            </button>
          ) : null}
          {step === 'mapping' ? (
            <button
              type="button"
              className="button primary"
              onClick={() => void handleImport()}
              disabled={!plan || plan.transactions.length === 0 || busy}
            >
              {busy ? <Loader2 size={15} className="is-spinning" /> : <Check size={15} />}
              {busy
                ? '导入中…'
                : `导入 ${plan?.transactions.length ?? 0} 笔`}
            </button>
          ) : null}
          {step === 'done' ? (
            <button type="button" className="button primary" onClick={onClose}>
              完成
            </button>
          ) : null}
        </div>
      </footer>
    </Modal>
  )
}
