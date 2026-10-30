/**
 * Small, dependency-free CSV / text plumbing shared by every exchange
 * adapter. Keeping it here means the adapters deal only with rows and fields.
 */

export type Encoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030'

export interface DecodedText {
  text: string
  encoding: Encoding
}

function tryDecode(
  bytes: Uint8Array,
  encoding: Encoding,
  fatal = false,
): string | null {
  try {
    return new TextDecoder(encoding, { fatal }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Chinese bill exports are inconsistent: WeChat writes UTF-8, older Alipay
 * exports write GBK. Prefer a strict UTF-8 decode, then fall back; a BOM wins
 * over both because it is unambiguous.
 */
export function decodeBytes(bytes: Uint8Array): DecodedText {
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return {
      text: tryDecode(bytes.subarray(3), 'utf-8') ?? '',
      encoding: 'utf-8',
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      text: tryDecode(bytes.subarray(2), 'utf-16le') ?? '',
      encoding: 'utf-16le',
    }
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return {
      text: tryDecode(bytes.subarray(2), 'utf-16be') ?? '',
      encoding: 'utf-16be',
    }
  }

  const strict = tryDecode(bytes, 'utf-8', true)
  if (strict !== null) return { text: strict, encoding: 'utf-8' }

  const gbk = tryDecode(bytes, 'gb18030')
  if (gbk !== null) return { text: gbk, encoding: 'gb18030' }

  return {
    text: tryDecode(bytes, 'utf-8') ?? '',
    encoding: 'utf-8',
  }
}

/** Decodes with an explicitly chosen encoding; used when auto-detection guesses wrong. */
export function decodeBytesAs(bytes: Uint8Array, encoding: Encoding): string {
  return tryDecode(bytes, encoding) ?? ''
}

/** Parses RFC-4180-ish CSV: quotes, escaped quotes, CRLF and stray blank lines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let touched = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"'
          index += 1
        } else {
          quoted = false
        }
      } else {
        cell += char
      }
      touched = true
      continue
    }

    if (char === '"') {
      quoted = true
      touched = true
      continue
    }
    if (char === ',') {
      row.push(cell)
      cell = ''
      touched = true
      continue
    }
    if (char === '\r' || char === '\n') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(cell)
      if (touched || row.some((value) => value.length > 0)) rows.push(row)
      row = []
      cell = ''
      touched = false
      continue
    }

    cell += char
    touched = true
  }

  row.push(cell)
  if (touched || row.some((value) => value.length > 0)) rows.push(row)
  return rows
}

/** Trims every cell and drops a leading UTF-8 BOM from the first one. */
export function cleanRows(rows: string[][]): string[][] {
  return rows.map((row, rowIndex) =>
    row.map((cell, cellIndex) => {
      const trimmed = cell.replace(/^﻿/, '').trim()
      if (rowIndex === 0 && cellIndex === 0) return trimmed
      return trimmed
    }),
  )
}

/** Lower-cases Latin text, unifies parentheses and strips all whitespace. */
export function normalizeHeader(value: string): string {
  return value
    .replace(/^﻿/, '')
    .replace(/[（]/g, '(')
    .replace(/[）]/g, ')')
    .replace(/[：]/g, ':')
    .replace(/\s+/g, '')
    .toLowerCase()
}

const TWO_DIGITS = (value: number): string => String(value).padStart(2, '0')

export interface ParsedDate {
  date: string
  time: string
}

function isValidYmd(year: number, month: number, day: number): boolean {
  if (year < 1900 || year > 2200) return false
  if (month < 1 || month > 12) return false
  if (day < 1 || day > 31) return false
  const probe = new Date(Date.UTC(year, month - 1, day))
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  )
}

/**
 * Reads the date shapes Chinese bill exports actually use: `2026-01-02`,
 * `2026/1/2`, `2026.1.2`, `2026年1月2日`, `20260102`, each optionally followed
 * by a clock time.
 */
export function parseDateValue(raw: string): ParsedDate | null {
  const text = raw.trim()
  if (!text) return null

  let year = 0
  let month = 0
  let day = 0
  let rest = ''

  const separated = /^(\d{4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/.exec(text)
  if (separated) {
    year = Number(separated[1])
    month = Number(separated[2])
    day = Number(separated[3])
    rest = text.slice(separated[0].length)
  } else {
    const compact = /^(\d{4})(\d{2})(\d{2})/.exec(text)
    if (!compact) return null
    year = Number(compact[1])
    month = Number(compact[2])
    day = Number(compact[3])
    rest = text.slice(compact[0].length)
  }

  if (!isValidYmd(year, month, day)) return null
  const time = parseTimeValue(rest)
  return {
    date: `${year}-${TWO_DIGITS(month)}-${TWO_DIGITS(day)}`,
    time,
  }
}

/** Reads `12:34`, `12:34:56` or a compact `123456` clock suffix. */
export function parseTimeValue(raw: string): string {
  const text = raw.trim()
  const colon = /(?:T|\s)*(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text)
  if (colon) {
    const hour = Number(colon[1])
    const minute = Number(colon[2])
    const second = colon[3] === undefined ? 0 : Number(colon[3])
    if (hour <= 23 && minute <= 59 && second <= 59) {
      return `${TWO_DIGITS(hour)}:${TWO_DIGITS(minute)}`
    }
  }
  return ''
}

/**
 * Parses an amount into integer cents without floating-point rounding
 * surprises. Returns null for text that is not a number.
 */
export function parseAmountCents(raw: string): number | null {
  let text = raw
    .replace(/[¥￥$€£,，\s]/g, '')
    .replace(/元$/, '')
    .trim()
  if (!text) return null

  let negative = false
  if (/^\(.*\)$/.test(text)) {
    negative = true
    text = text.slice(1, -1)
  }
  if (text.startsWith('-') || text.startsWith('−')) {
    negative = true
    text = text.slice(1)
  } else if (text.startsWith('+')) {
    text = text.slice(1)
  }

  if (!/^\d+(?:\.\d+)?$/.test(text)) return null
  const [integer, fraction = ''] = text.split('.')
  const padded = `${fraction}000`
  let cents = Number(integer) * 100 + Number(padded.slice(0, 2))
  if (Number(padded[2]) >= 5) cents += 1
  if (!Number.isFinite(cents)) return null
  return negative ? -cents : cents
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : ''
  const absolute = Math.abs(cents)
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

/** Escapes one CSV cell. Mirrors `escapeCsv` in utils but keeps this module standalone. */
export function csvCell(value: string | number): string {
  const text = String(value)
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

export function toCsv(rows: Array<Array<string | number>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/** A short, stable one-line preview of a row for the skipped list. */
export function previewRow(cells: string[], limit = 60): string {
  const text = cells.filter((cell) => cell.length > 0).join(' · ')
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}
