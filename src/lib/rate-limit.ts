// In-memory rate limiter — per-key sliding window.
// Resets on server restart. Sufficient for single-instance sandbox.

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
    private readonly cleanupMs: number = 5 * 60 * 1000
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

    if (!entry || entry.resetAt < now) {
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

  /** Stop the cleanup timer (for graceful shutdown / tests) */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
  }
}
