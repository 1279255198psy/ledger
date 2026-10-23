export const GITHUB_REPO = '1279255198psy/ledger'
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO}`
export const GITHUB_RELEASES_URL = `${GITHUB_REPO_URL}/releases`

const GITHUB_LATEST_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`

export interface GithubReleaseAsset {
  name: string
  url: string
  size: number | null
}

export interface GithubRelease {
  version: string
  notes: string | null
  publishedAt: string | null
  htmlUrl: string
  assets: GithubReleaseAsset[]
}

interface GithubApiAsset {
  name?: unknown
  browser_download_url?: unknown
  size?: unknown
}

interface GithubApiRelease {
  tag_name?: unknown
  body?: unknown
  html_url?: unknown
  published_at?: unknown
  assets?: unknown
}

export function normalizeVersion(version: string): string {
  return version.trim().replace(/^v/i, '')
}

/** Compares dotted numeric versions. Returns 1 when a is newer than b. */
export function compareVersions(a: string, b: string): number {
  const left = normalizeVersion(a)
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10) || 0)
  const right = normalizeVersion(b)
    .split(/[.+-]/)
    .map((part) => Number.parseInt(part, 10) || 0)
  const length = Math.max(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

export async function fetchLatestRelease(
  timeoutMs = 8_000,
): Promise<GithubRelease | null> {
  const controller = new AbortController()
  const timer = window.setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(GITHUB_LATEST_API, {
      cache: 'no-store',
      headers: { Accept: 'application/vnd.github+json' },
      signal: controller.signal,
    })

    // A repository without any release answers 404; let the caller treat it
    // as “nothing published yet” instead of a network failure.
    if (response.status === 404) return null
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`)

    const payload = (await response.json()) as GithubApiRelease
    const tag = typeof payload.tag_name === 'string' ? payload.tag_name : ''
    if (!tag) throw new Error('GitHub 返回的版本号无效')

    const rawAssets = Array.isArray(payload.assets) ? payload.assets : []
    const assets: GithubReleaseAsset[] = rawAssets
      .map((item) => {
        const asset = item as GithubApiAsset
        return {
          name: typeof asset.name === 'string' ? asset.name : '',
          url:
            typeof asset.browser_download_url === 'string'
              ? asset.browser_download_url
              : '',
          size:
            typeof asset.size === 'number' && asset.size > 0
              ? asset.size
              : null,
        }
      })
      .filter((asset) => asset.name && asset.url)

    return {
      version: normalizeVersion(tag),
      notes: typeof payload.body === 'string' ? payload.body.trim() : null,
      publishedAt:
        typeof payload.published_at === 'string'
          ? payload.published_at
          : null,
      htmlUrl:
        typeof payload.html_url === 'string'
          ? payload.html_url
          : GITHUB_RELEASES_URL,
      assets,
    }
  } finally {
    window.clearTimeout(timer)
  }
}

export function findApkAsset(release: GithubRelease): GithubReleaseAsset | null {
  return (
    release.assets.find((asset) => /\.apk$/i.test(asset.name)) ?? null
  )
}
