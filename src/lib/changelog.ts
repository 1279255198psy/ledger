import changelogSource from '../changelog.md?raw'

export interface ChangelogEntry {
  /** "3.5.3" */
  version: string
  /** YYYY-MM-DD, empty when the source line had no date. */
  date: string
  /** Short release theme such as "周期记账". */
  title: string
  items: string[]
}

/**
 * Reads the small, deliberately plain subset of Markdown the release script
 * writes: "## version · date · title" headings followed by "- " bullets.
 * Anything else is ignored rather than rendered, so the app never executes or
 * interprets release notes.
 */
export function parseChangelog(source: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = []
  let current: ChangelogEntry | null = null

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (line.startsWith('## ')) {
      const [version, date = '', ...titleParts] = line
        .slice(3)
        .split('·')
        .map((part) => part.trim())
      if (!version) continue
      current = {
        version,
        date,
        title: titleParts.join(' · '),
        items: [],
      }
      entries.push(current)
      continue
    }
    if (current && line.startsWith('- ')) {
      const item = line.slice(2).trim()
      if (item) current.items.push(item)
    }
  }

  return entries
}

export const CHANGELOG = parseChangelog(changelogSource)
