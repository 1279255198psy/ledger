#!/usr/bin/env node
/**
 * 账页 · 从发布记录生成 src/changelog.md
 *
 * 每个 tag 的 .github/workflows/release.yml 里保存着当时的 releaseBody，
 * 这里把它们整理成应用内「历史更新」读取的 Markdown。
 *
 * 文件放在 src/ 里，是为了让 Android 副本只复制 src 也能带上完整历史。
 *
 * 用法：
 *   node scripts/build-changelog.mjs
 *   node scripts/build-changelog.mjs --version 3.5.4
 *
 * 传入 --version 时，该版本优先读取工作区的 release.yml（发布前还没打 tag）。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const versionIndex = argv.indexOf('--version')
const workingVersion =
  versionIndex >= 0 ? String(argv[versionIndex + 1] || '').replace(/^v/, '') : ''

const git = (args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim()

const readYaml = (tag) => {
  if (tag) return git(['show', `${tag}:.github/workflows/release.yml`])
  return readFileSync(resolve(ROOT, '.github/workflows/release.yml'), 'utf8')
}

/** Pulls the YAML block scalar that follows `releaseBody: |`. */
function extractReleaseBody(yaml) {
  const lines = yaml.split(/\r?\n/)
  const start = lines.findIndex((line) => /releaseBody:\s*\|/.test(line))
  if (start < 0) return ''

  const blockIndent = lines[start].match(/^(\s*)/)[1].length
  const block = []
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index]
    if (!line.trim()) {
      block.push('')
      continue
    }
    if (line.match(/^(\s*)/)[1].length <= blockIndent) break
    block.push(line)
  }

  const contentIndent = Math.min(
    ...block
      .filter((line) => line.trim())
      .map((line) => line.match(/^(\s*)/)[1].length),
  )
  return block
    .map((line) => (line.trim() ? line.slice(contentIndent) : ''))
    .join('\n')
    .trim()
}

function parseReleaseBody(body, version) {
  const text = body.replace(/__VERSION__/g, version)
  const lines = text.split(/\r?\n/).map((line) => line.trim())
  const titleLine = lines.find((line) => line.includes('·'))
  const title = titleLine
    ? titleLine.split('·').slice(1).join('·').trim()
    : ''
  const items = lines
    .filter((line) => line.startsWith('- '))
    .map((line) => line.slice(2).trim())
  return { title, items }
}

const tags = git(['tag', '--sort=-v:refname'])
  .split('\n')
  .map((tag) => tag.trim())
  .filter((tag) => /^v\d+\.\d+\.\d+$/.test(tag))

const entries = []
for (const tag of tags) {
  const version = tag.slice(1)
  const yaml =
    workingVersion && version === workingVersion ? readYaml(null) : readYaml(tag)
  const body = extractReleaseBody(yaml)
  if (!body) continue
  const date = git(['log', '-1', '--format=%ad', '--date=short', tag])
  const { title, items } = parseReleaseBody(body, version)
  if (!title && items.length === 0) continue
  entries.push({ version, date, title, items })
}

if (workingVersion) {
  const exists = entries.some((entry) => entry.version === workingVersion)
  if (!exists) {
    const body = extractReleaseBody(readYaml(null))
    if (body) {
      const date = new Date().toISOString().slice(0, 10)
      const { title, items } = parseReleaseBody(body, workingVersion)
      entries.unshift({ version: workingVersion, date, title, items })
    }
  }
}

const sections = entries.map((entry) => {
  const heading = [entry.version, entry.date, entry.title]
    .filter(Boolean)
    .join(' · ')
  const lines = entry.items.map((item) => `- ${item}`)
  return `## ${heading}\n\n${lines.length > 0 ? lines.join('\n') : '- 这一版没有留下条目。'}`
})

const output = `# 账页 · 更新日志

> 记录每个正式版本的主要变化。设置 → 关于账页 → 历史更新 会读取这份文件。

${sections.join('\n\n')}
`

writeFileSync(resolve(ROOT, 'src/changelog.md'), output, 'utf8')
console.log(`已生成 src/changelog.md，共 ${entries.length} 个版本。`)
