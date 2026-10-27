/**
 * Small promise wrapper around one IndexedDB key-value store. The ledger keeps
 * its bulky records here instead of localStorage, which browsers cap at about
 * five megabytes per origin.
 *
 * Everything resolves to `null`/`false` when IndexedDB is unavailable (private
 * browsing, an embedded webview without storage, another tab blocking the
 * upgrade), so callers can fall back to localStorage without special cases.
 */

const DB_NAME = 'zhangye.local'
const DB_VERSION = 1
const STORE_NAME = 'kv'
const OPEN_TIMEOUT_MS = 2500

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)

  return new Promise((resolve) => {
    let settled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const finish = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close()
        return
      }
      settled = true
      if (timer !== null) clearTimeout(timer)
      if (db) {
        db.onversionchange = () => {
          db.close()
          dbPromise = null
        }
      }
      resolve(db)
    }

    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME)
        }
      }
      request.onsuccess = () => finish(request.result)
      request.onerror = () => finish(null)
      request.onblocked = () => finish(null)
      // A wedged upgrade must not hold up the first paint forever.
      timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS)
    } catch {
      finish(null)
    }
  })
}

function getDatabase(): Promise<IDBDatabase | null> {
  if (!dbPromise) dbPromise = openDatabase()
  return dbPromise
}

export async function idbAvailable(): Promise<boolean> {
  return (await getDatabase()) !== null
}

export async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await getDatabase()
  if (!db) return undefined

  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly')
      const request = transaction.objectStore(STORE_NAME).get(key)
      request.onsuccess = () => resolve(request.result as T | undefined)
      request.onerror = () => resolve(undefined)
      transaction.onabort = () => resolve(undefined)
    } catch {
      resolve(undefined)
    }
  })
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  const db = await getDatabase()
  if (!db) return false

  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      resolve(ok)
    }
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).put(value, key)
      transaction.oncomplete = () => finish(true)
      transaction.onerror = () => finish(false)
      transaction.onabort = () => finish(false)
    } catch {
      finish(false)
    }
  })
}

export async function idbDelete(key: string): Promise<boolean> {
  const db = await getDatabase()
  if (!db) return false

  return new Promise((resolve) => {
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      resolve(ok)
    }
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite')
      transaction.objectStore(STORE_NAME).delete(key)
      transaction.oncomplete = () => finish(true)
      transaction.onerror = () => finish(false)
      transaction.onabort = () => finish(false)
    } catch {
      finish(false)
    }
  })
}
