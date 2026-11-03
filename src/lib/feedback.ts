import { GITHUB_REPO_URL, normalizeVersion } from './github'
import { isDesktopApp } from './desktop'
import { isAndroidApp, isMobileApp } from './platform'

/** Keeps the encoded issue URL short enough for browsers and the shell. */
export const FEEDBACK_BODY_LIMIT = 2000
const MAX_ISSUE_URL_LENGTH = 30_000

export interface FeedbackContext {
  version: string
  platform: string
  system: string
}

export class FeedbackUrlError extends Error {}

export function feedbackPlatformLabel(): string {
  if (isDesktopApp()) return '桌面版'
  if (isAndroidApp()) return 'Android 版'
  if (isMobileApp()) return '移动版'
  return '网页版'
}

/** A short, human-readable OS name; the raw user agent is never included. */
export function feedbackSystemLabel(): string {
  if (typeof navigator === 'undefined') return '未知'

  const ua = navigator.userAgent
  const android = ua.match(/Android\s+([\d.]+)/i)
  if (android) return `Android ${android[1]}`

  if (/iPhone|iPad|iPod/i.test(ua)) {
    const ios = ua.match(/OS\s+(\d+[_.]\d+)/)
    return ios ? `iOS ${ios[1].replace('_', '.')}` : 'iOS'
  }
  if (/Windows NT 10\.0/i.test(ua)) return 'Windows 10/11'
  if (/Windows NT 6\.3/i.test(ua)) return 'Windows 8.1'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Mac OS X|Macintosh/i.test(ua)) return 'macOS'
  if (/Linux/i.test(ua)) return 'Linux'
  return '未知'
}

export function collectFeedbackContext(): FeedbackContext {
  return {
    version: normalizeVersion(__APP_VERSION__),
    platform: feedbackPlatformLabel(),
    system: feedbackSystemLabel(),
  }
}

export function buildFeedbackIssueBody(
  content: string,
  context: FeedbackContext | null,
): string {
  const text = content.trim()
  if (!context) return text

  return [
    text,
    '',
    '---',
    '',
    '**运行信息**',
    '',
    `- 账页版本：v${context.version}`,
    `- 平台：${context.platform}`,
    `- 系统：${context.system}`,
  ].join('\n')
}

/** Uses the first non-empty line as the issue title so the list stays readable. */
function summarizeTitle(content: string): string {
  const firstLine =
    content
      .trim()
      .split(/\r?\n/)
      .find((line) => line.trim().length > 0) ?? ''
  const cleaned = firstLine.replace(/^[#>*\-\s]+/, '').trim()
  if (!cleaned) return '账页使用反馈'
  return cleaned.length > 42 ? `${cleaned.slice(0, 42)}…` : cleaned
}

/**
 * Builds GitHub's "new issue" link with the text and diagnostics filled in.
 * The user still reviews the page and presses Submit themselves, so nothing
 * leaves the device until they do.
 */
export function buildFeedbackIssueUrl(
  content: string,
  context: FeedbackContext | null,
): string {
  const title = summarizeTitle(content)
  const body = buildFeedbackIssueBody(content, context)
  const url =
    `${GITHUB_REPO_URL}/issues/new` +
    `?title=${encodeURIComponent(title)}` +
    `&body=${encodeURIComponent(body)}`

  if (url.length > MAX_ISSUE_URL_LENGTH) {
    throw new FeedbackUrlError('内容太长了，请精简后再提交，或者先复制内容')
  }
  return url
}
