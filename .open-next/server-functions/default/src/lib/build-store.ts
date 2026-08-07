// Build Result Store — in-memory store for completed build results.
// Solves: SSE stream drops → client never receives the result.
// The client polls /api/build/result?id=xxx to recover.

import { logger } from './logger'

export interface StoredBuildResult {
  id: string
  html: string
  tokens: number
  ms: number
  quality: number
  metrics: string
  files?: { path: string; content: string; language: string }[]
  outputType?: string
  previewable?: boolean
  suggestions?: string[]
  error?: string
  status: 'building' | 'completed' | 'failed'
  timestamp: number
}

// v23: Use globalThis to persist the store across module reloads in dev mode.
// Without this, Turbopack creates a new Map for each request, so the result
// route can't find builds stored by the code route.
const globalStore = globalThis as unknown as { __novaBuildStore?: Map<string, StoredBuildResult> }
const store: Map<string, StoredBuildResult> = globalStore.__novaBuildStore ?? new Map()
if (!globalStore.__novaBuildStore) {
  globalStore.__novaBuildStore = store
  logger.info('buildstore.initialized', { storeSize: 0 })
}

const TTL_MS = 10 * 60 * 1000
const MAX_ENTRIES = 50

let cleanupTimer: ReturnType<typeof setInterval> | null = null

function startCleanup(): void {
  if (cleanupTimer) return
  cleanupTimer = setInterval(() => {
    const now = Date.now()
    for (const [id, entry] of store) {
      if (now - entry.timestamp > TTL_MS) store.delete(id)
    }
  }, 2 * 60 * 1000)
  if (cleanupTimer.unref) cleanupTimer.unref()
}

export function registerBuild(id: string): void {
  startCleanup()
  store.set(id, { id, html: '', tokens: 0, ms: 0, quality: 0, metrics: '', status: 'building', timestamp: Date.now() })
  if (store.size > MAX_ENTRIES) {
    const oldest = [...store.entries()].sort((a, b) => a[1].timestamp - b[1].timestamp)[0]
    if (oldest) store.delete(oldest[0])
  }
  logger.info('buildstore.registered', { id, size: store.size })
}

export function storeResult(id: string, result: Omit<StoredBuildResult, 'id' | 'status' | 'timestamp'>): void {
  const existing = store.get(id)
  store.set(id, { ...result, id, status: 'completed', timestamp: existing?.timestamp ?? Date.now() })
  logger.info('buildstore.stored', { id, status: 'completed', htmlBytes: result.html?.length ?? 0 })
}

export function storeError(id: string, error: string): void {
  const existing = store.get(id)
  store.set(id, { id, html: '', tokens: 0, ms: 0, quality: 0, metrics: '', error, status: 'failed', timestamp: existing?.timestamp ?? Date.now() })
  logger.info('buildstore.stored', { id, status: 'failed' })
}

export function getResult(id: string): StoredBuildResult | null {
  const entry = store.get(id)
  if (!entry) {
    logger.info('buildstore.get_miss', { id, storeSize: store.size })
    return null
  }
  if (Date.now() - entry.timestamp > TTL_MS) {
    store.delete(id)
    logger.info('buildstore.get_expired', { id, age: Date.now() - entry.timestamp })
    return null
  }
  logger.info('buildstore.get_hit', { id, status: entry.status })
  return entry
}
