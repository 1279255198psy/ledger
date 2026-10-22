import { useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Palette, Pencil, Plus, Trash2, X } from 'lucide-react'
import {
  CATEGORY_ICON_OPTIONS,
  CategoryIcon,
  getCategoryIconKey,
} from './CategoryIcon'
import {
  CATEGORY_COLORS,
  categoryColor,
  defaultCategoryColor,
} from '../lib/categories'
import type { CategoryDraft } from '../lib/categories'
import type { Category, TransactionType } from '../types'

interface CategorySettingsProps {
  categories: Category[]
  transactionUsage: Record<string, number>
  projectUsage: Record<string, number>
  onCreate: (draft: CategoryDraft) => void
  onUpdate: (id: string, draft: CategoryDraft) => void
  onDelete: (id: string) => void
}

interface EditorState extends CategoryDraft {
  mode: 'create' | 'edit'
  id?: string
}

export function CategorySettings({
  categories,
  transactionUsage,
  projectUsage,
  onCreate,
  onUpdate,
  onDelete,
}: CategorySettingsProps) {
  const [tab, setTab] = useState<TransactionType>('expense')
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [error, setError] = useState('')

  const visible = categories.filter((category) => category.type === tab)

  const startCreate = () => {
    setEditor({
      mode: 'create',
      type: tab,
      name: '',
      color: defaultCategoryColor(categories.length),
      icon: tab === 'expense' ? 'shapes' : 'ellipsis',
    })
    setError('')
  }

  const startEdit = (category: Category) => {
    setEditor({
      mode: 'edit',
      id: category.id,
      type: category.type,
      name: category.name,
      color: categoryColor(category),
      icon: getCategoryIconKey(category),
    })
    setError('')
  }

  const closeEditor = () => {
    setEditor(null)
    setError('')
  }

  const switchTab = (next: TransactionType) => {
    setTab(next)
    closeEditor()
  }

  const editingCategory =
    editor?.mode === 'edit'
      ? categories.find((category) => category.id === editor.id)
      : undefined
  const typeLocked = Boolean(
    editingCategory &&
      ((transactionUsage[editingCategory.id] ?? 0) > 0 ||
        (projectUsage[editingCategory.id] ?? 0) > 0),
  )
  const typeCategories = categories.filter(
    (category) => category.type === (editingCategory?.type ?? editor?.type),
  )

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!editor) return
    const name = editor.name.trim()
    if (!name) {
      setError('给这个分类起一个名字')
      return
    }
    if (name.length > 20) {
      setError('分类名称最多 20 个字')
      return
    }
    if (
      categories.some(
        (category) =>
          category.id !== editor.id &&
          category.type === editor.type &&
          category.name.trim().toLowerCase() === name.toLowerCase(),
      )
    ) {
      setError('同一收支类型下已经有同名分类')
      return
    }

    if (editor.mode === 'edit' && editingCategory) {
      if (editingCategory.type !== editor.type) {
        if (typeLocked) {
          setError('这个分类下已有流水或项目预算，不能更改收支类型')
          return
        }
        if (typeCategories.length <= 1) {
          setError(
            `${editingCategory.type === 'expense' ? '支出' : '收入'}分类至少保留一个`,
          )
          return
        }
      }
      onUpdate(editingCategory.id, {
        type: editor.type,
        name,
        color: editor.color,
        icon: editor.icon,
      })
    } else {
      onCreate({
        type: editor.type,
        name,
        color: editor.color,
        icon: editor.icon,
      })
    }

    setTab(editor.type)
    closeEditor()
  }

  const handleDelete = (category: Category) => {
    setError('')
    const transactions = transactionUsage[category.id] ?? 0
    if (transactions > 0) {
      setError(
        `「${category.name}」下还有 ${transactions} 笔流水，请先到流水里改用其他分类。`,
      )
      return
    }
    const projects = projectUsage[category.id] ?? 0
    if (projects > 0) {
      setError(
        `「${category.name}」还被 ${projects} 个项目的分类预算使用，请先调整项目预算。`,
      )
      return
    }
    if (
      categories.filter((item) => item.type === category.type).length <= 1
    ) {
      setError(
        `${category.type === 'expense' ? '支出' : '收入'}分类至少保留一个。`,
      )
      return
    }
    if (editor?.id === category.id) setEditor(null)
    onDelete(category.id)
  }

  return (
    <div className="category-admin">
      <div className="category-admin-tabs" role="group" aria-label="分类类型">
        {(
          [
            ['expense', '支出分类'],
            ['income', '收入分类'],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={tab === value ? 'is-active' : ''}
            onClick={() => switchTab(value)}
            aria-pressed={tab === value}
          >
            {label}
            <span>
              {categories.filter((category) => category.type === value).length}
            </span>
          </button>
        ))}
      </div>

      <div className="category-admin-list">
        {visible.map((category) => {
          const transactions = transactionUsage[category.id] ?? 0
          const projects = projectUsage[category.id] ?? 0
          return (
            <div className="category-admin-row" key={category.id}>
              <CategoryIcon category={category} size={17} />
              <div className="category-admin-copy">
                <strong>{category.name}</strong>
                <small>
                  {transactions > 0 ? `${transactions} 笔流水` : '还没有流水'}
                  {projects > 0 ? ` · ${projects} 个项目预算` : ''}
                </small>
              </div>
              <button
                type="button"
                className="category-admin-action"
                onClick={() => startEdit(category)}
                aria-label={`编辑${category.name}`}
                title="编辑"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                className="category-admin-action category-admin-action--danger"
                onClick={() => handleDelete(category)}
                aria-label={`删除${category.name}`}
                title="删除"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )
        })}
      </div>

      <button type="button" className="category-admin-add" onClick={startCreate}>
        <Plus size={14} />
        新建{tab === 'expense' ? '支出' : '收入'}分类
      </button>

      {error ? (
        <p className="form-error" role="alert">
          {error}
        </p>
      ) : null}

      {editor ? (
        <form className="category-editor" onSubmit={handleSubmit}>
          <div className="category-editor-head">
            <strong>
              {editor.mode === 'create' ? '新建分类' : `编辑「${editingCategory?.name}」`}
            </strong>
            <button
              type="button"
              className="icon-button"
              onClick={closeEditor}
              aria-label="关闭分类编辑"
            >
              <X size={17} />
            </button>
          </div>

          <div className="category-editor-top">
            <label className="field">
              <span className="field-label">名称</span>
              <input
                value={editor.name}
                onChange={(event) => {
                  setEditor({ ...editor, name: event.target.value })
                  setError('')
                }}
                placeholder="例如：咖啡"
                maxLength={20}
                aria-label="分类名称"
              />
            </label>
            <div className="field">
              <span className="field-label">收支类型</span>
              <div
                className="category-type-switch"
                role="group"
                aria-label="收支类型"
              >
                {(
                  [
                    ['expense', '支出'],
                    ['income', '收入'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={editor.type === value ? 'is-active' : ''}
                    disabled={typeLocked && editor.type !== value}
                    onClick={() => {
                      setEditor({ ...editor, type: value })
                      setError('')
                    }}
                    aria-pressed={editor.type === value}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {typeLocked ? (
                <small className="category-editor-hint">
                  已有流水或项目预算，不能更改收支类型
                </small>
              ) : null}
            </div>
          </div>

          <div className="field">
            <span className="field-label">颜色</span>
            <div className="category-color-grid">
              {CATEGORY_COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`category-color-swatch${
                    editor.color.toLowerCase() === color.toLowerCase()
                      ? ' is-active'
                      : ''
                  }`}
                  style={{ background: color }}
                  onClick={() =>
                    setEditor({ ...editor, color })
                  }
                  aria-label={`使用颜色 ${color}`}
                  aria-pressed={
                    editor.color.toLowerCase() === color.toLowerCase()
                  }
                >
                  {editor.color.toLowerCase() === color.toLowerCase() ? (
                    <Check size={11} strokeWidth={3} />
                  ) : null}
                </button>
              ))}
              <label className="category-color-custom" title="自定义颜色">
                <Palette size={14} />
                <input
                  type="color"
                  value={editor.color}
                  onChange={(event) =>
                    setEditor({ ...editor, color: event.target.value })
                  }
                  aria-label="自定义颜色"
                />
              </label>
            </div>
          </div>

          <div className="field">
            <span className="field-label">图标</span>
            <div className="category-icon-grid">
              {CATEGORY_ICON_OPTIONS.map(({ key, label, Icon }) => (
                <button
                  key={key}
                  type="button"
                  className={editor.icon === key ? 'is-active' : ''}
                  onClick={() => setEditor({ ...editor, icon: key })}
                  aria-label={label}
                  aria-pressed={editor.icon === key}
                  title={label}
                >
                  <Icon size={16} strokeWidth={1.8} />
                </button>
              ))}
            </div>
          </div>

          <div className="category-editor-actions">
            <button
              type="button"
              className="button ghost"
              onClick={closeEditor}
            >
              取消
            </button>
            <button type="submit" className="button primary">
              {editor.mode === 'create' ? '创建分类' : '保存分类'}
            </button>
          </div>
        </form>
      ) : null}
    </div>
  )
}
