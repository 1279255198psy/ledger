import { useCallback, useEffect, useRef, useState } from 'react'
import type { DownloadEvent, Update } from '@tauri-apps/plugin-updater'
import { isDesktopApp } from '../lib/desktop'
import { flushDesktopPersist } from '../lib/storage'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'

export type UpdateErrorStage = 'check' | 'download' | 'install' | null

interface UpdateState {
  phase: UpdatePhase
  version: string | null
  notes: string | null
  publishedAt: string | null
  downloadedBytes: number
  contentLength: number | null
  error: string | null
  errorStage: UpdateErrorStage
}

export interface UpdaterController extends UpdateState {
  supported: boolean
  currentVersion: string
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
  error: null,
  errorStage: null,
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

export function useUpdater(): UpdaterController {
  const supported = isDesktopApp()
  const [state, setState] = useState<UpdateState>(INITIAL_STATE)
  const [currentVersion, setCurrentVersion] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const updateRef = useRef<Update | null>(null)
  const busyRef = useRef(false)
  const readyRef = useRef(false)

  useEffect(() => {
    if (!supported) return
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
  }, [supported])

  useEffect(() => {
    return () => {
      const pending = updateRef.current
      updateRef.current = null
      if (pending) void pending.close().catch(() => undefined)
    }
  }, [])

  const runCheck = useCallback(
    async (silent: boolean) => {
      if (!supported) return
      if (busyRef.current || readyRef.current || updateRef.current) {
        setDialogOpen(true)
        return
      }

      busyRef.current = true
      if (!silent) setDialogOpen(true)
      setState((current) => ({
        ...current,
        phase: 'checking',
        error: null,
        errorStage: null,
        downloadedBytes: 0,
        contentLength: null,
      }))

      try {
        const { check } = await import('@tauri-apps/plugin-updater')
        const next = await check({ timeout: 20_000 })
        updateRef.current = next

        if (next) {
          setDialogOpen(true)
          setState({
            phase: 'available',
            version: next.version,
            notes: next.body?.trim() || null,
            publishedAt: next.date ?? null,
            downloadedBytes: 0,
            contentLength: null,
            error: null,
            errorStage: null,
          })
        } else {
          if (!silent) setDialogOpen(true)
          setState({
            phase: 'up-to-date',
            version: null,
            notes: null,
            publishedAt: null,
            downloadedBytes: 0,
            contentLength: null,
            error: null,
            errorStage: null,
          })
        }
      } catch (error) {
        console.error('检查更新失败', error)
        if (silent && !updateRef.current) {
          setState((current) => ({
            ...current,
            phase: 'idle',
            error: null,
            errorStage: null,
          }))
        } else {
          setDialogOpen(true)
          if (updateRef.current) {
            setState((current) => ({
              ...current,
              phase: 'available',
              error: null,
              errorStage: null,
            }))
          } else {
            setState((current) => ({
              ...current,
              phase: 'error',
              error: describeUpdateError(error, 'check'),
              errorStage: 'check',
            }))
          }
        }
      } finally {
        busyRef.current = false
      }
    },
    [supported],
  )

  const startDownload = useCallback(async () => {
    const update = updateRef.current
    if (!supported || !update || busyRef.current) return

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
  }, [supported])

  const installUpdate = useCallback(async () => {
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
  }, [supported])

  const checkForUpdates = useCallback(() => runCheck(false), [runCheck])

  useEffect(() => {
    // A packaged build quietly checks shortly after launch. Development builds
    // can still use the manual check without a request on every hot reload.
    if (!supported || import.meta.env.DEV) return
    const timer = window.setTimeout(() => {
      void runCheck(true)
    }, 2500)
    return () => window.clearTimeout(timer)
  }, [runCheck, supported])

  return {
    ...state,
    supported,
    currentVersion,
    dialogOpen,
    checkForUpdates,
    startDownload,
    backgroundDownload: () => setDialogOpen(false),
    installUpdate,
    openDialog: () => setDialogOpen(true),
    dismissDialog: () => setDialogOpen(false),
  }
}
