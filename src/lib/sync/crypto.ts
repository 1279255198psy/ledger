import type { SyncEnvelope, SyncPayload } from './types'

/**
 * Crockford base32: no I, L, O or U, so the code can be read out loud without
 * confusing characters. Ten characters carry 50 bits, which is far beyond a
 * guessable PIN and still short enough to type once on a phone.
 */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
export const SYNC_CODE_LENGTH = 10
const PBKDF2_ITERATIONS = 210_000

const encoder = new TextEncoder()
const decoder = new TextDecoder()

const keyCache = new Map<string, Promise<CryptoKey>>()
const tokenCache = new Map<string, Promise<string>>()

export class SyncCryptoError extends Error {}

export function generateSyncCode(): string {
  const bytes = new Uint8Array(SYNC_CODE_LENGTH)
  crypto.getRandomValues(bytes)
  let code = ''
  for (const byte of bytes) {
    // 256 is a multiple of 32, so the modulo is unbiased.
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
  }
  return code
}

/** Accepts lowercase, spaces and hyphens, and folds the ambiguous letters. */
export function normalizeSyncCode(value: string): string {
  let code = ''
  for (const char of value.toUpperCase()) {
    const mapped =
      char === 'I' || char === 'L'
        ? '1'
        : char === 'O'
          ? '0'
          : char === 'U'
            ? 'V'
            : char
    if (CODE_ALPHABET.includes(mapped)) code += mapped
  }
  return code
}

export function isValidSyncCode(value: string): boolean {
  const normalized = normalizeSyncCode(value)
  return (
    normalized.length === SYNC_CODE_LENGTH &&
    [...normalized].every((char) => CODE_ALPHABET.includes(char))
  )
}

export function formatSyncCode(code: string): string {
  const normalized = normalizeSyncCode(code)
  return `${normalized.slice(0, 5)}-${normalized.slice(5)}`
}

export function generatePairingId(): string {
  return randomHex(16)
}

export function generateDeviceId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return randomHex(16)
}

function randomHex(length: number): string {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(text))
}

/**
 * Derives the AES key from the sync code. The salt is derived from the code
 * itself, so the phone only has to type one value. The code has 50 bits of
 * entropy, and PBKDF2 makes an offline guess of the ciphertext impractical.
 */
export function deriveSyncKey(code: string): Promise<CryptoKey> {
  const normalized = normalizeSyncCode(code)
  const cached = keyCache.get(normalized)
  if (cached) return cached

  const task = (async () => {
    const salt = await sha256(`zhangye-sync-salt:v1:${normalized}`)
    const material = await crypto.subtle.importKey(
      'raw',
      encoder.encode(normalized),
      'PBKDF2',
      false,
      ['deriveKey'],
    )
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: PBKDF2_ITERATIONS,
        hash: 'SHA-256',
      },
      material,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
  })()

  keyCache.set(normalized, task)
  // A failed derivation must not poison the cache.
  task.catch(() => keyCache.delete(normalized))
  return task
}

/** The server sees only this token, never the code itself. */
export function deriveSyncToken(code: string): Promise<string> {
  const normalized = normalizeSyncCode(code)
  const cached = tokenCache.get(normalized)
  if (cached) return cached

  const task = sha256(`zhangye-sync-token:v1:${normalized}`).then((digest) =>
    bytesToBase64Url(new Uint8Array(digest)),
  )
  tokenCache.set(normalized, task)
  task.catch(() => tokenCache.delete(normalized))
  return task
}

export async function encryptPayload(
  payload: SyncPayload,
  key: CryptoKey,
): Promise<SyncEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = encoder.encode(JSON.stringify(payload))
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  )
  return {
    v: 1,
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(cipher)),
  }
}

export async function decryptPayload(
  envelope: SyncEnvelope,
  key: CryptoKey,
): Promise<SyncPayload> {
  if (!envelope || envelope.v !== 1) {
    throw new SyncCryptoError('同步数据版本不兼容')
  }
  let iv: Uint8Array
  let data: Uint8Array
  try {
    iv = base64ToBytes(envelope.iv)
    data = base64ToBytes(envelope.data)
  } catch {
    throw new SyncCryptoError('同步数据已损坏')
  }
  if (iv.length !== 12 || data.length === 0) {
    throw new SyncCryptoError('同步数据已损坏')
  }

  let plaintext: ArrayBuffer
  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      data,
    )
  } catch {
    throw new SyncCryptoError('同步码不匹配，或数据被改动过')
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(decoder.decode(plaintext))
  } catch {
    throw new SyncCryptoError('同步数据无法解析')
  }
  if (!isSyncPayload(parsed)) {
    throw new SyncCryptoError('同步数据格式不兼容')
  }
  return parsed
}

export function parseSyncEnvelope(text: string): SyncEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new SyncCryptoError('电脑返回的同步数据无法解析')
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as SyncEnvelope).v !== 1 ||
    typeof (parsed as SyncEnvelope).iv !== 'string' ||
    typeof (parsed as SyncEnvelope).data !== 'string'
  ) {
    throw new SyncCryptoError('电脑返回的同步数据格式不兼容')
  }
  return parsed as SyncEnvelope
}

function isSyncPayload(value: unknown): value is SyncPayload {
  if (!value || typeof value !== 'object') return false
  const payload = value as Partial<SyncPayload>
  return (
    payload.v === 1 &&
    (payload.sender === 'desktop' || payload.sender === 'mobile') &&
    typeof payload.deviceId === 'string' &&
    typeof payload.pairingId === 'string' &&
    typeof payload.seq === 'number' &&
    Number.isInteger(payload.seq) &&
    payload.seq > 0 &&
    typeof payload.sentAt === 'string' &&
    (payload.mode === 'snapshot' || payload.mode === 'replace') &&
    Boolean(payload.snapshot) &&
    typeof payload.snapshot === 'object'
  )
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}
