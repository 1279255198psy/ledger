import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Check, Copy, Github, ShieldCheck } from 'lucide-react'
import { copyText } from '../lib/clipboard'
import {
  FEEDBACK_BODY_LIMIT,
  FeedbackUrlError,
  buildFeedbackIssueBody,
  buildFeedbackIssueUrl,
  collectFeedbackContext,
} from '../lib/feedback'
import { openExternalUrl } from '../lib/links'

/**
 * The app has no server, so feedback is handed to GitHub instead: the text is
 * prefilled into a new issue and the user reviews and submits it there.
 */
export function FeedbackSection() {
  const [content, setContent] = useState('')
  const [includeContext, setIncludeContext] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const context = useMemo(() => collectFeedbackContext(), [])
  const trimmed = content.trim()

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    if (trimmed.length < 4) {
      setNotice('')
      setError('先写几句反馈内容，再提交')
      return
    }

    setError('')
    setNotice('')
    try {
      const url = buildFeedbackIssueUrl(
        trimmed,
        includeContext ? context : null,
      )
      await openExternalUrl(url)
      setNotice(
        '已打开 GitHub 的新 issue 页面，确认内容后点「Submit new issue」提交，我就能收到了。',
      )
    } catch (reason) {
      setError(
        reason instanceof FeedbackUrlError
          ? reason.message
          : '没有打开 GitHub 页面，可以先复制内容，再手动到 GitHub 提交',
      )
    }
  }

  const handleCopy = async () => {
    if (!trimmed) {
      setError('先写几句反馈内容，再复制')
      return
    }

    setError('')
    setNotice('')
    const body = buildFeedbackIssueBody(
      trimmed,
      includeContext ? context : null,
    )
    const copied = await copyText(body)
    if (copied) {
      setNotice('已复制反馈内容，可以粘贴到 GitHub 的 issue 正文里。')
    } else {
      setError('复制失败，请手动选中文字复制')
    }
  }

  return (
    <section className="settings-section feedback-section">
      <div className="settings-heading">
        <h3>意见反馈</h3>
        <p>
          遇到问题、想加功能，或者对账页有别的想法，都可以写在这里。提交会打开
          GitHub 的新 issue 页面，确认内容后点「Submit new issue」即可。需要登录
          GitHub。
        </p>
      </div>

      <form className="feedback-form" onSubmit={handleSubmit}>
        <label className="field">
          <span className="field-label">
            反馈内容 <span className="optional">必填</span>
          </span>
          <textarea
            value={content}
            onChange={(event) => {
              setContent(event.target.value)
              setError('')
              setNotice('')
            }}
            maxLength={FEEDBACK_BODY_LIMIT}
            rows={7}
            placeholder="例如：在 Android 上导入微信账单后，退款的那一笔金额变成了正数。希望退款能自动识别成支出减少。"
            aria-label="反馈内容"
          />
          <span className="feedback-counter">
            {content.length} / {FEEDBACK_BODY_LIMIT}
          </span>
        </label>

        <label className="feedback-context">
          <input
            type="checkbox"
            checked={includeContext}
            onChange={(event) => setIncludeContext(event.target.checked)}
          />
          <span>
            <strong>附带运行信息</strong>
            <small>
              v{context.version} · {context.platform} · {context.system}
            </small>
          </span>
        </label>

        {error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : null}

        {notice ? (
          <p className="feedback-notice">
            <Check size={15} aria-hidden />
            {notice}
          </p>
        ) : null}

        <div className="feedback-actions">
          <button
            type="submit"
            className="button primary"
            disabled={trimmed.length < 4}
          >
            <Github size={15} />
            提交到 GitHub
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => void handleCopy()}
            disabled={trimmed.length < 4}
          >
            <Copy size={15} />
            复制内容
          </button>
        </div>
      </form>

      <p className="privacy-note">
        <ShieldCheck size={15} />
        {includeContext
          ? '只附带版本、平台和系统名称，不会包含任何账目数据。'
          : '提交内容只包含你写的文字。'}
      </p>
    </section>
  )
}
