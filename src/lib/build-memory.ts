// Build Memory — IndexedDB cache for past builds.
//
// NOVA caches every successful build in IndexedDB. When a user submits a mission
// that matches a past build (even with different word order), NOVA can:
// - Return the cached build instantly (no LLM call)
// - Suggest similar past builds in the UI
//
// This is a CLIENT-SIDE cache (runs in the browser). It gracefully degrades to
// a no-op when IndexedDB is unavailable (private browsing, old browsers, SSR).
//
// Cache policy:
// - TTL: 30 days (entries older than 30 days are deleted on next access)
// - MAX_BUILDS: 200 (oldest entries evicted when exceeded)
// - Lookup: normalized mission (lowercase, sorted words, no punctuation) —
//   word-order independent ("snake game" == "game snake")

import type { BuildResult } from './helpers'

// ── Types ──

/** A cached build — extends BuildResult with quality score and timestamp. */
export interface CachedBuild extends BuildResult {
  /** Quality score from build-intelligence.validateOutput (0-100). */
  quality: number
  /** Unix timestamp (ms) when the build was cached. */
  timestamp: number
  /** The normalized mission (for deduplication and lookup). */
  normalizedMission: string
}

// ── Constants ──

const DB_NAME = 'nova-build-memory'
const STORE_NAME = 'builds'
const DB_VERSION = 1
const TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MAX_BUILDS = 200

// ── Mission normalization ──

/**
 * Normalize a mission string for storage and lookup.
 *
 * 1. Lowercase
 * 2. Strip punctuation (keep only letters, digits, spaces)
 * 3. Split into words, sort alphabetically, rejoin
 *
 * This makes the lookup word-order independent:
 *   "build a snake game"  →  "a build game snake"
 *   "game snake a build"  →  "a build game snake"  (same!)
 *
 * It also collapses whitespace and removes diacritics-less casing differences.
 */
export function normalizeMission(mission: string): string {
  if (!mission) return ''
  const lower = mission.toLowerCase()
  // Keep only alphanumeric and spaces (strip punctuation, emojis, etc.)
  const cleaned = lower.replace(/[^a-z0-9\s]/g, ' ')
  // Split on whitespace, filter empties, sort, rejoin
  const words = cleaned.split(/\s+/).filter(w => w.length > 0)
  words.sort()
  return words.join(' ')
}

// ── IndexedDB availability check ──

/**
 * Check if IndexedDB is available in the current environment.
 * Returns false in:
 * - Server-side rendering (no `indexedDB` global)
 * - Private browsing mode (Safari throws on indexedDB.open)
 * - Old browsers
 */
function isIndexedDBAvailable(): boolean {
  if (typeof indexedDB === 'undefined') return false
  if (typeof window === 'undefined') return false
  // Safari private mode: indexedDB exists but open() throws
  try {
    const req = indexedDB.open('__nova_test__', 1)
    req.onsuccess = () => { try { req.result.close() } catch {} }
    req.onerror = () => {}
    return true
  } catch {
    return false
  }
}

// ── DB connection management ──

let dbPromise: Promise<IDBDatabase | null> | null = null

/**
 * Open (or create) the IndexedDB database.
 * Returns null if IndexedDB is unavailable or open fails.
 * The result is cached so subsequent calls reuse the same connection.
 */
function getDb(): Promise<IDBDatabase | null> {
  if (!isIndexedDBAvailable()) return Promise.resolve(null)
  if (dbPromise) return dbPromise

  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' })
          // Index on normalizedMission for fast exact-match lookup
          store.createIndex('normalizedMission', 'normalizedMission', { unique: false })
          // Index on timestamp for fast range queries (recent builds)
          store.createIndex('timestamp', 'timestamp', { unique: false })
        }
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })

  return dbPromise
}

// ── Public API ──

/**
 * Cache a build in IndexedDB.
 *
 * If a build with the same normalized mission already exists, it's replaced
 * (we keep the most recent one). If the cache exceeds MAX_BUILDS, the oldest
 * entries are evicted.
 *
 * No-op if IndexedDB is unavailable.
 */
export async function cacheBuild(build: BuildResult, quality: number): Promise<void> {
  const db = await getDb()
  if (!db) return

  const normalized = normalizeMission(build.mission)
  if (!normalized) return // don't cache builds with empty missions

  const cached: CachedBuild = {
    ...build,
    quality: Math.round(quality),
    timestamp: Date.now(),
    normalizedMission: normalized,
  }

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)

      // First, delete any existing build with the same normalized mission.
      // (Avoids accumulating duplicates when the user re-runs the same mission.)
      const idx = store.index('normalizedMission')
      const rangeReq = idx.openCursor(IDBKeyRange.only(normalized))
      rangeReq.onsuccess = () => {
        const cursor = rangeReq.result
        if (cursor) {
          store.delete(cursor.primaryKey)
          cursor.continue()
        }
      }
      rangeReq.onerror = () => resolve()

      tx.oncomplete = () => {
        // Now insert the new build in a second transaction.
        try {
          const tx2 = db.transaction(STORE_NAME, 'readwrite')
          const store2 = tx2.objectStore(STORE_NAME)
          store2.put(cached)
          tx2.oncomplete = () => {
            // Evict oldest entries if we're over the limit
            evictOldest(db).then(() => resolve()).catch(() => resolve())
          }
          tx2.onerror = () => resolve()
        } catch {
          resolve()
        }
      }
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

/**
 * Find a cached build by exact normalized-mission match.
 * Word-order independent: "snake game" matches "game snake".
 *
 * Returns null if no match, the build is expired (TTL), or IndexedDB is unavailable.
 */
export async function findCachedBuildNormalized(mission: string): Promise<CachedBuild | null> {
  const db = await getDb()
  if (!db) return null

  const normalized = normalizeMission(mission)
  if (!normalized) return null

  return new Promise<CachedBuild | null>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const idx = store.index('normalizedMission')
      const req = idx.get(normalized)
      req.onsuccess = () => {
        const result = req.result as CachedBuild | undefined
        if (!result) {
          resolve(null)
          return
        }
        // TTL check
        if (Date.now() - result.timestamp > TTL_MS) {
          // Expired — delete it and return null
          try {
            const delTx = db.transaction(STORE_NAME, 'readwrite')
            delTx.objectStore(STORE_NAME).delete(result.id)
            delTx.oncomplete = () => resolve(null)
            delTx.onerror = () => resolve(null)
          } catch {
            resolve(null)
          }
          return
        }
        resolve(result)
      }
      req.onerror = () => resolve(null)
    } catch {
      resolve(null)
    }
  })
}

/**
 * Find builds whose missions share words with the given mission.
 * Used for "similar builds" suggestions in the UI.
 *
 * Strategy: load recent builds (capped at `limit`), score each by word-overlap
 * with the query mission, return the top matches.
 *
 * @param mission The user's mission text.
 * @param limit Maximum number of similar builds to return. Default 5.
 */
export async function findSimilarBuilds(mission: string, limit: number = 5): Promise<CachedBuild[]> {
  const recent = await getRecentBuilds(50) // search through the last 50 builds
  if (recent.length === 0) return []

  const queryWords = new Set(
    mission.toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2) // skip very short words (a, an, the)
  )
  if (queryWords.size === 0) return []

  const scored = recent
    .map(build => {
      const buildWords = new Set(
        build.mission.toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(w => w.length > 2)
      )
      let overlap = 0
      for (const w of queryWords) {
        if (buildWords.has(w)) overlap++
      }
      return { build, score: overlap }
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(item => item.build)

  return scored
}

/**
 * Get the most recent builds, newest first.
 * Uses a reverse cursor on the timestamp index — does NOT load all 200 builds
 * and sort in JS. Only reads `limit` entries from disk.
 *
 * @param limit Maximum number of builds to return. Default 10. Capped at 200.
 */
export async function getRecentBuilds(limit: number = 10): Promise<CachedBuild[]> {
  const db = await getDb()
  if (!db) return []

  const cap = Math.max(1, Math.min(limit, MAX_BUILDS))
  const cutoff = Date.now() - TTL_MS

  return new Promise<CachedBuild[]>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const idx = store.index('timestamp')
      const results: CachedBuild[] = []

      // Open a reverse cursor (newest first)
      const req = idx.openCursor(null, 'prev')
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) {
          resolve(results)
          return
        }
        const build = cursor.value as CachedBuild
        // Skip expired entries (don't return them, but don't delete here —
        // deletion happens lazily on lookup or explicitly via cleanup)
        if (build.timestamp >= cutoff) {
          results.push(build)
        }
        if (results.length >= cap) {
          resolve(results)
          return
        }
        cursor.continue()
      }
      req.onerror = () => resolve(results)
    } catch {
      resolve([])
    }
  })
}

/**
 * Load ALL builds from the cache. Used for admin/debug views.
 * Note: this loads everything into memory — use sparingly.
 * Returns empty array if IndexedDB is unavailable.
 */
export async function getAllBuilds(): Promise<CachedBuild[]> {
  const db = await getDb()
  if (!db) return []

  return new Promise<CachedBuild[]>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly')
      const store = tx.objectStore(STORE_NAME)
      const req = store.getAll()
      req.onsuccess = () => {
        const all = (req.result as CachedBuild[]) ?? []
        // Filter out expired entries
        const cutoff = Date.now() - TTL_MS
        resolve(all.filter(b => b.timestamp >= cutoff))
      }
      req.onerror = () => resolve([])
    } catch {
      resolve([])
    }
  })
}

/**
 * Delete all expired entries from the cache.
 * Called lazily by other operations, but can also be called explicitly.
 * Returns the number of entries deleted.
 */
export async function cleanupExpired(): Promise<number> {
  const db = await getDb()
  if (!db) return 0

  const cutoff = Date.now() - TTL_MS
  let deleted = 0

  return new Promise<number>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const idx = store.index('timestamp')
      // Open a cursor over entries with timestamp < cutoff
      const req = idx.openCursor(IDBKeyRange.upperBound(cutoff))
      req.onsuccess = () => {
        const cursor = req.result
        if (!cursor) return
        cursor.delete()
        deleted++
        cursor.continue()
      }
      req.onerror = () => resolve(deleted)
      tx.oncomplete = () => resolve(deleted)
      tx.onerror = () => resolve(deleted)
    } catch {
      resolve(0)
    }
  })
}

/**
 * Clear the entire build memory cache.
 * Used when the user clicks "Clear history" in the UI.
 */
export async function clearAllBuilds(): Promise<void> {
  const db = await getDb()
  if (!db) return

  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      tx.objectStore(STORE_NAME).clear()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}

// ── Internal helpers ──

/**
 * Evict the oldest entries when the cache exceeds MAX_BUILDS.
 * Uses a forward cursor on timestamp — deletes entries until we're under the limit.
 */
async function evictOldest(db: IDBDatabase): Promise<void> {
  return new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite')
      const store = tx.objectStore(STORE_NAME)
      const countReq = store.count()
      countReq.onsuccess = () => {
        const count = countReq.result
        if (count <= MAX_BUILDS) {
          resolve()
          return
        }
        const toDelete = count - MAX_BUILDS
        const idx = store.index('timestamp')
        let deleted = 0
        const cursorReq = idx.openCursor() // forward cursor = oldest first
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result
          if (!cursor || deleted >= toDelete) return
          cursor.delete()
          deleted++
          cursor.continue()
        }
        cursorReq.onerror = () => resolve()
      }
      countReq.onerror = () => resolve()
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    } catch {
      resolve()
    }
  })
}
