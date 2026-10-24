import { isMobileApp } from '../platform'

export class SyncHttpError extends Error {
  status: number

  constructor(message: string, status = 0) {
    super(message)
    this.status = status
  }
}

export interface SyncInfo {
  app: string
  protocol: number
  version: string
  name: string
  pairingId: string
  hasData: boolean
}

export interface BlobResponse {
  /** Null when the desktop has not written a snapshot yet. */
  text: string | null
  etag: string | null
}

interface HttpResult {
  status: number
  text: string
  headers: Record<string, string>
}

interface HttpRequest {
  url: string
  method: 'GET' | 'PUT'
  token?: string
  body?: string
  etag?: string | null
  extraHeaders?: Record<string, string>
}

const CONNECT_TIMEOUT = 5000
const READ_TIMEOUT = 20000

/** Accepts `192.168.1.5:47821`, adds a scheme and drops trailing slashes. */
export function normalizeSyncUrl(value: string): string {
  let url = value.trim()
  if (!url) throw new SyncHttpError('请输入电脑上显示的地址')
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`
  url = url.replace(/\/+$/, '')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new SyncHttpError('地址格式不正确')
  }
  if (!parsed.hostname) throw new SyncHttpError('地址格式不正确')
  return url
}

async function request({
  url,
  method,
  token,
  body,
  etag,
  extraHeaders,
}: HttpRequest): Promise<HttpResult> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
  }
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (etag) headers['If-Match'] = etag
  if (extraHeaders) Object.assign(headers, extraHeaders)

  if (isMobileApp()) {
    const { CapacitorHttp } = await import('@capacitor/core')
    try {
      const response = await CapacitorHttp.request({
        url,
        method,
        headers,
        data: body,
        responseType: 'text',
        connectTimeout: CONNECT_TIMEOUT,
        readTimeout: READ_TIMEOUT,
      })
      return {
        status: response.status,
        text:
          typeof response.data === 'string'
            ? response.data
            : JSON.stringify(response.data ?? ''),
        headers: lowerCaseHeaders(response.headers ?? {}),
      }
    } catch (error) {
      throw new SyncHttpError(
        error instanceof Error
          ? `无法连接电脑：${error.message}`
          : '无法连接电脑',
      )
    }
  }

  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), READ_TIMEOUT)
  try {
    const response = await fetch(url, {
      method,
      headers,
      body,
      signal: controller.signal,
    })
    const text = await response.text()
    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value
    })
    return { status: response.status, text, headers: responseHeaders }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new SyncHttpError('连接电脑超时，请确认在同一个 Wi-Fi 下')
    }
    throw new SyncHttpError('无法连接电脑，请检查地址和防火墙')
  } finally {
    window.clearTimeout(timer)
  }
}

function lowerCaseHeaders(headers: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    result[key.toLowerCase()] = value
  }
  return result
}

export async function fetchSyncInfo(baseUrl: string): Promise<SyncInfo> {
  const result = await request({ url: `${baseUrl}/v1/info`, method: 'GET' })
  if (result.status !== 200) {
    throw new SyncHttpError(
      `电脑没有响应同步请求（${result.status}）`,
      result.status,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(result.text)
  } catch {
    throw new SyncHttpError('电脑返回的信息无法识别')
  }
  const info = parsed as Partial<SyncInfo>
  if (
    info.app !== '账页' ||
    info.protocol !== 1 ||
    typeof info.pairingId !== 'string'
  ) {
    throw new SyncHttpError('这台电脑不是账页，或版本不兼容')
  }
  return {
    app: info.app,
    protocol: info.protocol,
    version: typeof info.version === 'string' ? info.version : '',
    name: typeof info.name === 'string' ? info.name : '电脑',
    pairingId: info.pairingId,
    hasData: info.hasData === true,
  }
}

export async function fetchSyncBlob(
  baseUrl: string,
  token: string,
): Promise<BlobResponse | null> {
  const result = await request({
    url: `${baseUrl}/v1/blob`,
    method: 'GET',
    token,
  })
  if (result.status === 404) return null
  if (result.status === 401) {
    throw new SyncHttpError('同步码不正确，请对照电脑上的同步码重新输入', 401)
  }
  if (result.status !== 200) {
    throw new SyncHttpError(`读取电脑数据失败（${result.status}）`, result.status)
  }
  return {
    text: result.text,
    etag: result.headers.etag ?? null,
  }
}

export async function pushSyncBlob(
  baseUrl: string,
  token: string,
  text: string,
  etag: string | null,
  extraHeaders?: Record<string, string>,
): Promise<{ etag: string | null; conflict: boolean }> {
  const result = await request({
    url: `${baseUrl}/v1/blob`,
    method: 'PUT',
    token,
    body: text,
    etag: etag ?? '*',
    extraHeaders,
  })
  if (result.status === 409) {
    return { etag: null, conflict: true }
  }
  if (result.status === 401) {
    throw new SyncHttpError('同步码已失效，请重新连接电脑', 401)
  }
  if (result.status === 413) {
    throw new SyncHttpError('账本数据太大，超出了同步上限', 413)
  }
  if (result.status !== 200) {
    throw new SyncHttpError(`写入电脑数据失败（${result.status}）`, result.status)
  }
  let nextEtag: string | null = result.headers.etag ?? null
  if (!nextEtag) {
    try {
      const parsed = JSON.parse(result.text) as { etag?: string }
      nextEtag = typeof parsed.etag === 'string' ? parsed.etag : null
    } catch {
      nextEtag = null
    }
  }
  return { etag: nextEtag, conflict: false }
}
