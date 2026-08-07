// In-memory rate limiter — per-key sliding window.
// Resets on server restart. Sufficient for single-instance sandbox.
//
// Memory protection: caps the number of tracked keys at maxKeys (default 10,000).
// If exceeded, the oldest entries are evicted. This prevents an attacker from
// exhausting memory by sending requests from millions of fake IPs.

interface RateLimitEntry {
  count: number
  resetAt: number
}

export interface RateLimitResult {
  ok: boolean
  remaining: number
  resetInMs: number
}

export class RateLimiter {
  private hits = new Map<string, RateLimitEntry>()
  private cleanupTimer: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly cleanupMs: number = 5 * 60 * 1000,
    private readonly maxKeys: number = 10_000
  ) {
    // Start periodic cleanup of expired entries
    if (typeof setInterval !== 'undefined') {
      this.cleanupTimer = setInterval(() => this.cleanup(), this.cleanupMs)
      this.cleanupTimer.unref?.()
    }
  }

  check(key: string): RateLimitResult {
    const now = Date.now()
    const entry = this.hits.get(key)

    // Handle max=0 (block everything) and expired/missing entries the same way:
    // if no entry or expired, create one with count=1, then check against max.
    if (!entry || entry.resetAt < now) {
      // If max is 0, block immediately
      if (this.max <= 0) {
        return { ok: false, remaining: 0, resetInMs: this.windowMs }
      }
      // Evict oldest entries if we're at the key cap (memory protection)
      if (this.hits.size >= this.maxKeys && !this.hits.has(key)) {
        this.evictOldest()
      }
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs })
      return { ok: true, remaining: this.max - 1, resetInMs: this.windowMs }
    }

    if (entry.count >= this.max) {
      return { ok: false, remaining: 0, resetInMs: entry.resetAt - now }
    }

    entry.count++
    return { ok: true, remaining: this.max - entry.count, resetInMs: entry.resetAt - now }
  }

  /** Reset a specific key (for testing) */
  reset(key: string): void {
    this.hits.delete(key)
  }

  /** Reset all keys (for testing) */
  resetAll(): void {
    this.hits.clear()
  }

  /** Remove expired entries */
  cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.hits) {
      if (entry.resetAt < now) this.hits.delete(key)
    }
  }

  /** Evict the entry with the earliest resetAt (oldest) — for memory protection */
  private evictOldest(): void {
    let oldestKey: string | null = null
    let oldestReset = Infinity
    for (const [key, entry] of this.hits) {
      if (entry.resetAt < oldestReset) {
        oldestReset = entry.resetAt
        oldestKey = key
      }
    }
    if (oldestKey) this.hits.delete(oldestKey)
  }

  /** Get the current number of tracked keys (for testing/monitoring) */
  get size(): number {
    return this.hits.size
  }

  /** Stop the cleanup timer (for graceful shutdown / tests) */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}
