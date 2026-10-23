import { useCallback, useEffect, useRef, useState } from 'react'
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater'
import { isDesktopApp } from '../lib/desktop'
import {
  compareVersions,
  fetchLatestRelease,
  findApkAsset,
  GITHUB_RELEASES_URL,
  normalizeVersion,
} from '../lib/github'
import { openExternalUrl } from '../lib/links'
import { isMobileApp } from '../lib/platform'
import { flushDesktopPersist } from '../lib/storage'

export type UpdatePlatform = 'desktop' | 'mobile'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'external'
  | 'error'

export type UpdateErrorStage = 'check' | 'download' | 'install' | null

interface UpdateState {
  phase: UpdatePhase
  version: string | null
  notes: string | null
  publishedAt: string | null
  downloadedBytes: number
  contentLength: number | null
  checkAttempt: number
  error: string | null
  errorStage: UpdateErrorStage
  downloadUrl: string | null
  releaseUrl: string | null
}

// GitHub is occasionally slow to respond in mainland China. Each attempt gets
// a short timeout, and a failed attempt is retried right away instead of
// leaving the check hanging for 20 seconds and then giving up.
const CHECK_TIMEOUT_MS = 8_000
const CHECK_ATTEMPTS = 3
const RETRY_DELAYS_MS = [500, 1_500]
// Re-check quietly while the app stays open. A failed check comes back sooner.
const BACKGROUND_CHECK_MS = 30 * 60 * 1000
const BACKGROUND_RETRY_MS = 5 * 60 * 1000
const FOCUS_CHECK_AFTER_MS = 10 * 60 * 1000

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

export interface UpdaterController extends UpdateState {
  platform: UpdatePlatform | null
  supported: boolean
  currentVersion: string
  manualDownloadUrl: string
  dialogOpen: boolean
  checkForUpdates: () => Promise<void>
  startDownload: () => Promise<void>
  backgroundDownload: () => void
  installUpdate: () => Promise<void>
  openDialog: () => void
  dismissDialog: () => void
}

const INITIAL_STATE: UpdateState = {
  phase: 'idle',
  version: null,
  notes: null,
  publishedAt: null,
  downloadedBytes: 0,
  contentLength: null,
  checkAttempt: 0,
  error: null,
  errorStage: null,
  downloadUrl: null,
  releaseUrl: null,
}

function describeUpdateError(
  error: unknown,
  stage: Exclude<UpdateErrorStage, null>,
): string {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw.toLowerCase()

  if (/signature|public key|verify|decrypt/.test(message)) {
    return '更新包签名校验没有通过，已停止安装。请前往 GitHub Releases 手动下载最新安装包。'
  }

  if (
    stage === 'check' &&
    /valid release json|release json|404|not found/.test(message)
  ) {
    return '没有读取到可用的更新清单。如果这是首次发布，请先发布包含 latest.json 的 GitHub Release；否则请稍后重试。'
  }

  const networkIssue =
    /network|dns|connect|timed out|timeout|ssl|certificate|offline|connection refused|failed to (?:send|receive)/.test(
      message,
    )

  if (stage === 'check') {
    if (networkIssue) return '无法连接更新服务器，请检查网络后重试。'
    return '检查更新失败，请稍后重试。'
  }

  if (networkIssue) return '下载更新时网络中断，请重试。'
  return '更新没有完成，请稍后重试；也可以前往 GitHub Releases 手动下载安装包。'
}

function describeMobileCheckError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  const message = raw.toLowerCase()
  const networkIssue =
    /abort|network|dns|connect|timed out|timeout|ssl|certificate|offline|failed to fetch|load failed|connection/.test(
      message,
    )

  if (networkIssue) {
    return '无法连接 GitHub，请检查网络后重试；也可以点击下方「手动下载」前往 GitHub Releases。'
  }
  return '检查更新失败，请稍后重试；也可以点击下方「手动下载」前往 GitHub Releases。'
}

export function useUpdater(): UpdaterController {
  const platform: UpdatePlatform | null = isDesktopApp()
    ? 'desktop'
    : isMobileApp()
      ? 'mobile'
      : null
  const supported = platform !== null
  const mobileVersionRef = useRef(normalizeVersion(__APP_VERSION__))
  const [state, setState] = useState<UpdateState>(INITIAL_STATE)
  const [currentVersion, setCurrentVersion] = useState(
    platform === 'mobile' ? mobileVersionRef.current : '',
  )
  const [dialogOpen, setDialogOpen] = useState(false)
  const updateRef = useRef<Update | null>(null)
  const busyRef = useRef(false)
  const readyRef = useRef(false)
  // Like updateRef on desktop: once an update is waiting and the user chose
  // “下次再说”, quiet checks must not reopen the dialog every half hour.
  const availableRef = useRef(false)
  const lastAttemptRef = useRef(0)
  const lastCheckOkRef = useRef(true)

  useEffect(() => {
    if (platform !== 'desktop') return
    let active = true
    void import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then((version) => {
        if (active) setCurrentVersion(version)
      })
      .catch((error) => {
        console.error('无法读取应用版本', error)
      })
    return () => {
      active = false
    }
  }, [platform])

  useEffect(() => {
    return () => {
      const pending = updateRef.current
      updateRef.current = null
      if (pending) void pending.close().catch(() => undefined)
    }
  }, [])

  const runMobileCheck = useCallback(async (silent: boolean) => {
    if (busyRef.current || availableRef.current) {
      if (!silent) setDialogOpen(true)
      return
    }

    busyRef.current = true
    lastAttemptRef.current = Date.now()
    if (!silent) setDialogOpen(true)
    setState({
      ...INITIAL_STATE,
      phase: 'checking',
      checkAttempt: 1,
    })

    try {
      let release = null
      let lastError: unknown = null

      for (let attempt = 1; attempt <= CHECK_ATTEMPTS; attempt += 1) {
        if (attempt > 1) {
          await wait(RETRY_DELAYS_MS[attempt - 2] ?? 2_000)
          setState((current) =>
            current.phase === 'checking'
              ? { ...current, checkAttempt: attempt }
              : current,
          )
        }
        try {
          release = await fetchLatestRelease(CHECK_TIMEOUT_MS)
          lastError = null
          break
        } catch (error) {
          lastError = error
          console.error(`检查手机版更新失败（第 ${attempt} 次）`, error)
        }
      }

      if (lastError) throw lastError
      lastCheckOkRef.current = true

      if (
        !release ||
        compareVersions(release.version, mobileVersionRef.current) <= 0
      ) {
        availableRef.current = false
        if (!silent) setDialogOpen(true)
        setState({ ...INITIAL_STATE, phase: 'up-to-date' })
        return
      }

      const latest = release.version
      const apk = findApkAsset(release)
      if (!apk) {
        if (!silent) setDialogOpen(true)
        setState({
          ...INITIAL_STATE,
          phase: 'error',
          version: latest,
          notes: release.notes,
          publishedAt: release.publishedAt,
          releaseUrl: release.htmlUrl,
          error: `v${latest} 已经在 GitHub 发布，但这次没有附带手机安装包。请前往 GitHub Releases 手动下载 APK。`,
          errorStage: 'check',
        })
        return
      }

      // A new version always opens the dialog, even after a quiet check.
      availableRef.current = true
      setDialogOpen(true)
      setState({
        ...INITIAL_STATE,
        phase: 'available',
        version: latest,
        notes: release.notes,
        publishedAt: release.publishedAt,
        downloadUrl: apk.url,
        releaseUrl: release.htmlUrl,
      })
    } catch (error) {
      console.error('检查手机版更新失败', error)
      lastCheckOkRef.current = false
      const message = describeMobileCheckError(error)
      // Never interrupt someone who is just opening the app offline; the
      // settings screen still shows that the last check failed.
      if (!silent) setDialogOpen(true)
      setState({
        ...INITIAL_STATE,
        phase: 'error',
        error: message,
        errorStage: 'check',
        releaseUrl: GITHUB_RELEASES_URL,
      })
    } finally {
      busyRef.current = false
    }
  }, [])

  const runCheck = useCallback(
    async (silent: boolean) => {
      if (!supported) return
      if (platform === 'mobile') {
        await runMobileCheck(silent)
        return
      }
      if (busyRef.current || readyRef.current || updateRef.current) {
        // A silent background check must never pop open a dialog, especially
        // when the user already chose “下次再说” for the cached update.
        if (!silent) setDialogOpen(true)
        return
      }

      busyRef.current = true
      lastAttemptRef.current = Date.now()
      if (!silent) setDialogOpen(true)
      setState((current) => ({
        ...current,
        phase: 'checking',
        checkAttempt: 1,
        error: null,
        errorStage: null,
        downloadedBytes: 0,
        contentLength: null,
      }))

      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        let next: Update | null = null
        let lastError: unknown = null

        for (let attempt = 1; attempt <= CHECK_ATTEMPTS; attempt += 1) {
          if (attempt > 1) {
            await wait(RETRY_DELAYS_MS[attempt - 2] ?? 2_000)
            setState((current) =>
              current.phase === 'checking'
                ? { ...current, checkAttempt: attempt }
                : current,
            )
          }
          try {
            next = await check({ timeout: CHECK_TIMEOUT_MS })
            lastError = null
            break
          } catch (error) {
            lastError = error
            console.error(`检查更新失败（第 ${attempt} 次）`, error)
          }
        }

        if (lastError) throw lastError

        lastCheckOkRef.current = true
        updateRef.current = next

        if (next) {
          setDialogOpen(true)
          setState({
            ...INITIAL_STATE,
            phase: 'available',
            version: next.version,
            notes: next.body?.trim() || null,
            publishedAt: next.date ?? null,
          })
        } else {
          if (!silent) setDialogOpen(true)
          setState({ ...INITIAL_STATE, phase: 'up-to-date' })
        }
      } catch (error) {
        console.error('检查更新失败', error)
        lastCheckOkRef.current = false
        if (silent && !updateRef.current) {
          setState((current) => ({
            ...current,
            phase: 'idle',
            checkAttempt: 0,
            error: null,
            errorStage: null,
          }))
        } else {
          setDialogOpen(true)
          if (updateRef.current) {
            setState((current) => ({
              ...current,
              phase: 'available',
              checkAttempt: 0,
              error: null,
              errorStage: null,
            }))
          } else {
            setState((current) => ({
              ...current,
              phase: 'error',
              checkAttempt: 0,
              error: describeUpdateError(error, 'check'),
              errorStage: 'check',
            }))
          }
        }
      } finally {
        busyRef.current = false
      }
    },
    [platform, runMobileCheck, supported],
  )

  const startDownload = useCallback(async () => {
    if (!supported || busyRef.current) return

    if (platform === 'mobile') {
      if (!state.downloadUrl) return
      setDialogOpen(true)
      setState((current) => ({
        ...current,
        phase: 'external',
        error: null,
        errorStage: null,
      }))
      try {
        await openExternalUrl(state.downloadUrl)
      } catch (error) {
        console.error('打开下载页面失败', error)
        setState((current) => ({
          ...current,
          phase: 'error',
          error: '无法打开下载页面，请前往 GitHub Releases 手动下载。',
          errorStage: 'check',
          releaseUrl: current.releaseUrl ?? GITHUB_RELEASES_URL,
        }))
      }
      return
    }

    const update = updateRef.current
    if (!update) return

    busyRef.current = true
    readyRef.current = false
    setDialogOpen(true)
    setState((current) => ({
      ...current,
      phase: 'downloading',
      error: null,
      errorStage: null,
      downloadedBytes: 0,
      contentLength: null,
    }))

    try {
      let downloaded = 0
      await update.download(
        (event: DownloadEvent) => {
          if (event.event === 'Started') {
            const total = event.data.contentLength
            setState((current) => ({
              ...current,
              contentLength:
                typeof total === 'number' && total > 0 ? total : null,
            }))
          } else if (event.event === 'Progress') {
            downloaded += event.data.chunkLength
            setState((current) => ({
              ...current,
              downloadedBytes: downloaded,
            }))
          } else {
            setState((current) => ({
              ...current,
              downloadedBytes: current.contentLength ?? downloaded,
            }))
          }
        },
        { timeout: 10 * 60 * 1000 },
      )

      readyRef.current = true
      setState((current) => ({
        ...current,
        phase: 'ready',
        downloadedBytes: current.contentLength ?? downloaded,
        error: null,
        errorStage: null,
      }))
      // Also opens after a background download, so the user is asked before
      // anything is installed.
      setDialogOpen(true)
    } catch (error) {
      console.error('下载更新失败', error)
      setDialogOpen(true)
      setState((current) => ({
        ...current,
        phase: 'error',
        error: describeUpdateError(error, 'download'),
        errorStage: 'download',
      }))
    } finally {
      busyRef.current = false
    }
  }, [platform, state.downloadUrl, supported])

  const installUpdate = useCallback(async () => {
    if (platform !== 'desktop') return
    const update = updateRef.current
    if (!supported || !update || busyRef.current) return
    if (!readyRef.current) {
      setDialogOpen(true)
      return
    }

    busyRef.current = true
    setDialogOpen(true)
    setState((current) => ({
      ...current,
      phase: 'installing',
      error: null,
      errorStage: null,
    }))

    try {
      // The save path is debounced, so flush the newest ledger immediately
      // before the installer stops the app.
      await flushDesktopPersist()
      await update.install({ restartAfterInstall: true })
    } catch (error) {
      console.error('安装更新失败', error)
      setDialogOpen(true)
      setState((current) => ({
        ...current,
        phase: 'error',
        error: describeUpdateError(error, 'install'),
        errorStage: 'install',
      }))
    } finally {
      busyRef.current = false
    }
  }, [platform, supported])

  const checkForUpdates = useCallback(() => runCheck(false), [runCheck])

  useEffect(() => {
    // A packaged build quietly checks shortly after launch, then keeps
    // re-checking while it stays open. Development builds can still use the
    // manual check without a request on every hot reload.
    if (!supported || import.meta.env.DEV) return

    let timer: number | null = null
    let disposed = false

    const schedule = (delay: number) => {
      if (disposed) return
      timer = window.setTimeout(async () => {
        timer = null
        await runCheck(true)
        schedule(
          lastCheckOkRef.current ? BACKGROUND_CHECK_MS : BACKGROUND_RETRY_MS,
        )
      }, delay)
    }

    const checkWhenBack = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastAttemptRef.current < FOCUS_CHECK_AFTER_MS) return
      void runCheck(true)
    }

    schedule(2500)
    window.addEventListener('focus', checkWhenBack)
    document.addEventListener('visibilitychange', checkWhenBack)

    return () => {
      disposed = true
      if (timer !== null) window.clearTimeout(timer)
      window.removeEventListener('focus', checkWhenBack)
      document.removeEventListener('visibilitychange', checkWhenBack)
    }
  }, [runCheck, supported])

  return {
    ...state,
    platform,
    supported,
    currentVersion,
    manualDownloadUrl: GITHUB_RELEASES_URL,
    dialogOpen,
    checkForUpdates,
    startDownload,
    backgroundDownload: () => setDialogOpen(false),
    installUpdate,
    openDialog: () => setDialogOpen(true),
    dismissDialog: () => setDialogOpen(false),
  }
}
